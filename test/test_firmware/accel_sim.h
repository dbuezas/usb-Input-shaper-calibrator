#pragma once

// Simulated ADXL345 / LIS2DW12 on the SPI bus, for host tests.
// It speaks SPI mode 3 at the pin level (for bit-banged SPI) and at the byte level (for hardware SPI),
// keeps a register file and a FIFO, and counts protocol errors.

#include <Arduino.h>
#include <SPI.h>

#include <array>
#include <cmath>
#include <deque>
#include <utility>
#include <vector>

struct AccelSim : mock::PinHook, mock::SpiHook {
  enum Chip { ADXL345, LIS2DW12 };

  Chip chip = ADXL345;
  int pin_cs = -1, pin_sck = -1, pin_mosi = -1, pin_miso = -1;
  bool bitbang = true;

  uint8_t regs[128] = {};
  std::deque<std::array<int16_t, 3>> fifo;            // raw 16-bit output words (x, y, z)
  std::vector<std::pair<uint8_t, uint8_t>> writes;     // register writes in order
  int protocol_errors = 0;                             // anything a real chip would not accept

  // transaction state
  bool selected = false;
  int byte_index = 0;
  uint8_t addr = 0;
  bool reading = false;
  bool auto_increment = false;
  bool pop_on_deselect = false;

  // pin state
  int sck = LOW, mosi = LOW, miso = LOW;
  int bit = 0;
  uint8_t in_byte = 0, out_byte = 0;

  void reset(Chip c, int cs, int sck_pin, int mosi_pin, int miso_pin, bool bit_banged) {
    *this = AccelSim();
    chip = c;
    pin_cs = cs;
    pin_sck = sck_pin;
    pin_mosi = mosi_pin;
    pin_miso = miso_pin;
    bitbang = bit_banged;
    if (chip == ADXL345) {
      regs[0x00] = 0xE5;  // DEVID
    } else {
      regs[0x0F] = 0x44;  // WHO_AM_I
      regs[0x21] = 0x04;  // CTRL2 reset value: IF_ADD_INC on
    }
  }

  // Adds a sample in g, encoded the way the chip stores it.
  void push_g(double x, double y, double z) {
    auto enc = [&](double g) -> int16_t {
      if (chip == ADXL345) {
        // full resolution, ±16g: 13 bit, right-justified, 3.9 mg/LSB
        long raw = std::lround(g / 0.0039);
        raw = std::min(4095L, std::max(-4096L, raw));
        return (int16_t)raw;
      }
      // high performance, ±16g: 14 bit, left-justified, 1.952 mg/LSB
      long raw = std::lround(g / 0.001952);
      raw = std::min(8191L, std::max(-8192L, raw));
      return (int16_t)(raw * 4);
    };
    fifo.push_back({enc(x), enc(y), enc(z)});
  }

  uint8_t data_reg_first() const { return chip == ADXL345 ? 0x32 : 0x28; }
  uint8_t fifo_status_reg() const { return chip == ADXL345 ? 0x39 : 0x2F; }

  uint8_t read_reg(uint8_t a) {
    uint8_t first = data_reg_first();
    if (a >= first && a < first + 6) {
      std::array<int16_t, 3> s = fifo.empty() ? std::array<int16_t, 3>{0, 0, 0} : fifo.front();
      int16_t word = s[(a - first) / 2];
      if (a == first + 5) pop_on_deselect = true;
      return (a - first) % 2 ? (uint8_t)((uint16_t)word >> 8) : (uint8_t)word;
    }
    if (a == fifo_status_reg())
      return (uint8_t)std::min<size_t>(fifo.size(), 32);
    return regs[a];
  }

  // byte level (one full-duplex byte)
  uint8_t next_out() { return (byte_index > 0 && reading) ? read_reg(addr) : 0; }

  void receive(uint8_t b) {
    if (byte_index == 0) {
      reading = b & 0x80;
      if (chip == ADXL345) {
        auto_increment = b & 0x40;
        addr = b & 0x3F;
      } else {
        auto_increment = regs[0x21] & 0x04;
        addr = b & 0x7F;
      }
    } else {
      if (!reading) {
        regs[addr] = b;
        writes.push_back({addr, b});
      }
      if (auto_increment) addr++;
    }
    byte_index++;
  }

  // mock::SpiHook (hardware SPI)
  uint8_t transfer(uint8_t val) override {
    if (!selected) {
      protocol_errors++;
      return 0;
    }
    uint8_t out = next_out();
    receive(val);
    return out;
  }

  // mock::PinHook (CS, and bit-banged SPI)
  void write(int pin, int val) override {
    if (pin == pin_cs) {
      if (val == LOW && !selected) {
        // SPI mode 3: the clock must idle high when CS falls
        if (bitbang && sck != HIGH) protocol_errors++;
        selected = true;
        byte_index = 0;
        bit = 0;
      } else if (val == HIGH && selected) {
        if (bit != 0) protocol_errors++;  // CS released in the middle of a byte
        selected = false;
        if (pop_on_deselect && !fifo.empty()) fifo.pop_front();
        pop_on_deselect = false;
      }
      return;
    }
    if (pin == pin_mosi) {
      mosi = val;
      return;
    }
    if (pin != pin_sck) return;

    if (selected && sck == HIGH && val == LOW) {
      // falling edge: the chip shifts out its next bit
      if (bit == 0) out_byte = next_out();
      miso = (out_byte >> (7 - bit)) & 1;
    } else if (selected && sck == LOW && val == HIGH) {
      // rising edge: the chip samples MOSI
      in_byte = (uint8_t)((in_byte << 1) | (mosi & 1));
      if (++bit == 8) {
        receive(in_byte);
        bit = 0;
        in_byte = 0;
      }
    }
    sck = val;
  }

  int read(int pin) override { return pin == pin_miso ? miso : LOW; }
};
