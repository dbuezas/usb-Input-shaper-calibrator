#pragma once

// Minimal hardware SPI API for running the firmware on the host (see test/test_firmware).
// Bytes are forwarded to `mock::spi`, which the tests point at a simulated accelerometer.

#include <Arduino.h>

#define MSBFIRST 1
#define SPI_MODE3 3

struct SPISettings {
  uint32_t clock;
  int bit_order;
  int mode;
  SPISettings(uint32_t clock, int bit_order, int mode) : clock(clock), bit_order(bit_order), mode(mode) {}
};

namespace mock {
  struct SpiHook {
    virtual uint8_t transfer(uint8_t val) = 0;
  };
  inline SpiHook* spi = nullptr;
}  // namespace mock

class SPIClass {
 public:
  bool begun = false;
  int mode = -1;

  void setMOSI(int) {}
  void setMISO(int) {}
  void setSCK(int) {}
  void setSCLK(int) {}
  void begin() { begun = true; }
  void beginTransaction(SPISettings settings) { mode = settings.mode; }
  uint8_t transfer(uint8_t val) { return mock::spi ? mock::spi->transfer(val) : 0; }
  void transfer(void* buf, size_t len) {
    uint8_t* bytes = (uint8_t*)buf;
    for (size_t i = 0; i < len; i++)
      bytes[i] = transfer(bytes[i]);
  }
};

inline SPIClass SPI;
inline SPIClass SPI1;
