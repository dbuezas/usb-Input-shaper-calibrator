#include <Arduino.h>

#include "configuration.h"

#define ACCEL_CHIP_ADXL345 1
#define ACCEL_CHIP_LIS2DW12 2

#if BOARD == BOARD_FLY_ADXL345
  #define PIN_MISO 12
  #define PIN_CS 9
  #define PIN_SCK 10
  #define PIN_MOSI 11
  #define ACCEL_CHIP ACCEL_CHIP_ADXL345
#elif BOARD == BOARD_BTT_LIS2DW
  #define PIN_MISO 8
  #define PIN_CS 9
  #define PIN_SCK 10
  #define PIN_MOSI 11
  #define ACCEL_CHIP ACCEL_CHIP_LIS2DW12
#elif BOARD == BOARD_FYSETC_PIS
  #define PIN_MISO 12
  #define PIN_CS 13
  #define PIN_SCK 10
  #define PIN_MOSI 11
  #define ACCEL_CHIP ACCEL_CHIP_ADXL345
#else
  #error "Unsupported BOARD selection"
#endif

// Packet delimiters
#define PACKET_START 0b10101010
#define PACKET_END 0b01010101

// Low-level SPI register helpers (defined later)
void write_reg(uint8_t reg, uint8_t val);
uint8_t read_reg(uint8_t reg);
void read_multi(uint8_t reg, uint8_t* buf, uint8_t len);

// ---------------------
// Chip-specific settings
// ---------------------
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345

  // ADXL345 registers
  #define REG_DATAX0 0b00110010
  #define REG_FIFO_STATUS 0b00111001
  #define REG_DATA_FORMAT 0b00110001
  #define REG_BW_RATE 0b00101100
  #define REG_POWER_CTL 0b00101101
  #define REG_FIFO_CTL 0b00111000

  // Bandwidth rate register values (BW_RATE)
  #define BW_3200HZ 0b00001111
  #define BW_1600HZ 0b00001110
  #define BW_800HZ 0b00001101
  #define BW_400HZ 0b00001100
  #define BW_200HZ 0b00001011
  #define BW_100HZ 0b00001010
  #define BW_50HZ 0b00001001
  #define BW_25HZ 0b00001000

  static inline void accel_init() {
    write_reg(REG_DATA_FORMAT, 0b00001011);  // 13 bit, ±16g
    write_reg(REG_BW_RATE, BW_3200HZ);       // 3200 Hz output rate
    write_reg(REG_POWER_CTL, 0b00001000);    // measurement mode
    write_reg(REG_FIFO_CTL, 0b10011111);     // stream mode, 32-sample FIFO
  }

#elif ACCEL_CHIP == ACCEL_CHIP_LIS2DW12

  // LIS2DW / IIS2DW12 (ST) registers (SPI)
  // Datasheet uses 8-bit reg addresses.
  #define REG_WHO_AM_I 0x0F
  #define LIS2DW_DEV_ID 0x44

  #define REG_STATUS 0x27

  #define REG_OUT_X_L 0x28
  #define REG_FIFO_CTRL 0x2E
  #define REG_FIFO_SAMPLES 0x2F

  #define REG_CTRL1 0x20
  #define REG_CTRL2 0x21
  #define REG_CTRL6 0x25

  // Note: LIS2DW outputs 14-bit left-justified data in 16-bit samples.
  static inline void accel_init() {
    // Mirror Klipper's initialization (spi mode):
    // - Disable I2C / enable address auto-increment via CTRL2
    // - ODR/2, +-16g, low-pass filter, low-noise via CTRL6
    // - FIFO continuous/stream mode via FIFO_CTRL
    // - High-performance 14-bit, 1600Hz via CTRL1
    write_reg(REG_CTRL2, 0x06);
    write_reg(REG_CTRL6, 0x34);
    write_reg(REG_FIFO_CTRL, 0xC0);
    write_reg(REG_CTRL1, 0x94);
  }

  // Map ADXL-style names used in the rest of the code to LIS2DW.
  #define REG_DATAX0 REG_OUT_X_L
  #define REG_FIFO_STATUS REG_FIFO_SAMPLES

#endif

union PackedXYZ {
  struct {
    signed int x : 13;
    signed int y : 13;
    signed int z : 13;
    unsigned int padding : 1;
  } data;
  uint8_t bytes[5];
};

// For ~1 MHz bit-bang on RP2040.
static inline void spi_delay() {
  // __asm volatile("nop; nop; nop; nop;");
  delayMicroseconds(0);
}

uint8_t spi_rw(uint8_t val) {
  uint8_t rx = 0;
  for (int8_t i = 7; i >= 0; i--) {
    // Output MOSI while clock is HIGH
    digitalWrite(PIN_MOSI, (val >> i) & 1);
    spi_delay();

    // FALLING edge (CPHA=1: CHANGE data here, do NOT sample)
    digitalWrite(PIN_SCK, LOW);
    spi_delay();

    // RISING edge (CPHA=1: SAMPLE here)
    digitalWrite(PIN_SCK, HIGH);
    spi_delay();
    rx = (rx << 1) | digitalRead(PIN_MISO);
  }
  return rx;
}

void write_reg(uint8_t reg, uint8_t val) {
  digitalWrite(PIN_CS, LOW);
  spi_rw(reg);
  spi_rw(val);
  digitalWrite(PIN_CS, HIGH);
}

uint8_t read_reg(uint8_t reg) {
  digitalWrite(PIN_CS, LOW);
  #if ACCEL_CHIP == ACCEL_CHIP_ADXL345
    spi_rw(reg | 0b10000000);
  #elif ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
    // ST SPI: bit7=R/W (1=read). Auto-increment is controlled via CTRL2.
    spi_rw(reg | 0b10000000);
  #endif
  uint8_t val = spi_rw(0b00000000);
  digitalWrite(PIN_CS, HIGH);
  return val;
}

void read_multi(uint8_t reg, uint8_t* buf, uint8_t len) {
  digitalWrite(PIN_CS, LOW);
  #if ACCEL_CHIP == ACCEL_CHIP_ADXL345
    spi_rw(reg | 0b11000000);  // READ + MULTI (ADXL345)
  #elif ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
    // ST SPI: bit7=R/W (1=read). Do NOT set ADXL's multi-bit (0x40).
    // Auto-increment is enabled via CTRL2=0x06 (set in accel_init()).
    spi_rw(reg | 0b10000000);
  #endif
  for (uint8_t i = 0; i < len; i++)
    buf[i] = spi_rw(0b00000000);
  digitalWrite(PIN_CS, HIGH);
}

// sent every so often to in case the receiving end missed a packet and started reading the bits offset from the beginning
union PackedXYZ const ALIGN_PACKET = {.bytes = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF}};

void drain_fifo() {
  #if ACCEL_CHIP == ACCEL_CHIP_ADXL345
    uint8_t fifo_level = read_reg(REG_FIFO_STATUS) & 0b00111111;
  #elif ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
    // FIFO_SAMPLES reports number of unread samples (0..31)
    uint8_t fifo_level = read_reg(REG_FIFO_STATUS) & 0b00011111;
  #endif

  #if ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
    // If FIFO isn't reporting samples, fall back to data-ready polling.
    if (fifo_level == 0) {
      uint8_t status = read_reg(REG_STATUS);
      if ((status & 0x01) == 0)
        return;
      fifo_level = 1;
    }
  #endif

  uint8_t buf[6];
  while (fifo_level--) {
    read_multi(REG_DATAX0, buf, sizeof(buf));

    // get real 16-bit signed values
    int16_t x16 = (buf[1] << 8) | buf[0];
    int16_t y16 = (buf[3] << 8) | buf[2];
    int16_t z16 = (buf[5] << 8) | buf[4];

    #if ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
      // LIS2DW outputs 14-bit left-justified data in 16-bit words.
      x16 >>= 2;
      y16 >>= 2;
      z16 >>= 2;
    #endif

    // convert to 13-bit signed
    uint32_t x13 = x16 & 0x1FFF;
    uint32_t y13 = y16 & 0x1FFF;
    uint32_t z13 = z16 & 0x1FFF;

    // pack 3×13 bits
    uint64_t bits = (uint64_t)x13 | ((uint64_t)y13 << 13) | ((uint64_t)z13 << 26);

    // output 6 bytes (little-endian)
    uint8_t out[6];
    out[0] = 255;
    out[1] = (uint8_t)(bits >> 0);
    out[2] = (uint8_t)(bits >> 8);
    out[3] = (uint8_t)(bits >> 16);
    out[4] = (uint8_t)(bits >> 24);
    out[5] = (uint8_t)(bits >> 32);

    #if SERIAL_DEBUG_TEXT
      // Avoid flooding the USB serial link; print at most ~20Hz.
      static uint32_t last_print_ms = 0;
      uint32_t now = millis();
      if (now - last_print_ms >= 50) {
        last_print_ms = now;
        Serial.printf("xyz: %d %d %d\r\n", (int)x16, (int)y16, (int)z16);
      }
    #else
      Serial.write(out, 6);
    #endif
  }
}

void setup() {
  Serial.begin(230400);
  #if SERIAL_DEBUG_TEXT
    // On RP2040 USB-CDC, Serial may not be immediately ready.
    uint32_t start_ms = millis();
    while (!Serial && (millis() - start_ms) < 2000) {
      delay(10);
    }
    Serial.printf("boot: board=%d chip=%d\r\n", BOARD, ACCEL_CHIP);
  #endif

  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_MOSI, OUTPUT);
  pinMode(PIN_MISO, INPUT);
  pinMode(PIN_SCK, OUTPUT);

  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_SCK, HIGH);
  delay(10);

  #if ACCEL_CHIP == ACCEL_CHIP_ADXL345
    uint8_t id = read_reg(0b00000000);
    #if SERIAL_DEBUG_TEXT
      Serial.printf("ADXL345 ID = 0x%02X\r\n", id);
    #endif

  #elif ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
    uint8_t id = read_reg(REG_WHO_AM_I);
    #if SERIAL_DEBUG_TEXT
      Serial.printf("LIS2DW WHO_AM_I = 0x%02X\r\n", id);
      if (id != LIS2DW_DEV_ID)
        Serial.printf("Unexpected LIS2DW id (expected 0x%02X)\r\n", LIS2DW_DEV_ID);
    #endif
  #endif

  accel_init();
}

void loop() {
  #if SERIAL_DEBUG_TEXT
    static uint32_t last_ms = 0;
    if (millis() - last_ms > 1000) {
      last_ms = millis();
      Serial.printf("hb: fifo=0x%02X\r\n", read_reg(REG_FIFO_STATUS));
    }
  #endif
  drain_fifo();
}
