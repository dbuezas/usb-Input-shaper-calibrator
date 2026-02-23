#include <Arduino.h>
#include <SPI.h>

#ifdef RT_BLUEPILL
    #include "usbd_cdc_if.h"
#endif //RT_BLUEPILL

//#define SPI_BITBANG

#define LED                 LED_BUILTIN

#ifdef RT_RP2040
    // Pins SPI1
    #define PIN_MISO        12
    #define PIN_MOSI        11
    #define PIN_SCK         10
    #define PIN_CS          9
#ifdef RT_PICO
    #define SMPS_PWM        23
#endif //RT_PICO

    #define ADXL_SPI        SPI1
    #define IS_CONNECTED    Serial.dtr()
#endif //RT_RP2040

#ifdef RT_BLUEPILL
    // Pins SPI1
    #define PIN_MOSI        PA7
    #define PIN_MISO        PA6
    #define PIN_SCK         PA5
    #define PIN_CS          PA4

    #define ADXL_SPI        SPI
    #define IS_CONNECTED    !CDC_connected()
#endif //RT_BLUEPILL


// FIFO registers
#define REG_DEVID       0x00
#define REG_DATAX0      0x32 //DATAX0-Z1 0x32...0x37
#define REG_FIFO_STATUS 0x39
#define REG_DATA_FORMAT 0x31
#define REG_BW_RATE     0x2C
#define REG_POWER_CTL   0x2D
#define REG_FIFO_CTL    0x38

// Bandwidth rate register values (BW_RATE)
#define BW_3200HZ 0b00001111
#define BW_1600HZ 0b00001110
#define BW_800HZ  0b00001101
#define BW_400HZ  0b00001100
#define BW_200HZ  0b00001011
#define BW_100HZ  0b00001010
#define BW_50HZ   0b00001001
#define BW_25HZ   0b00001000

#ifdef SPI_BITBANG
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

void spi_rw_multi(uint8_t *buf, uint8_t len) {
    for (uint8_t i = 0; i < len; i++)
        buf[i] = spi_rw(0b00000000);
}
#else
uint8_t spi_rw(uint8_t val) {
    return ADXL_SPI.transfer(val);
}

void spi_rw_multi(uint8_t *buf, uint8_t len) {
    ADXL_SPI.transfer(buf, len);
}
#endif //SPI_BITBANG


void write_reg(uint8_t reg, uint8_t val) {
    digitalWrite(PIN_CS, LOW);
    spi_rw(reg);
    spi_rw(val);
    digitalWrite(PIN_CS, HIGH);
}

uint8_t read_reg(uint8_t reg) {
    digitalWrite(PIN_CS, LOW);
    spi_rw(reg | 0b10000000);
    uint8_t val = spi_rw(0b00000000);
    digitalWrite(PIN_CS, HIGH);
    return val;
}

void read_multi(uint8_t reg, uint8_t *buf, uint8_t len) {
    digitalWrite(PIN_CS, LOW);
    spi_rw(reg | 0b11000000);  // READ + MULTI
    spi_rw_multi(buf, len);
    digitalWrite(PIN_CS, HIGH);
}


void drain_fifo() {
    uint8_t fifo_level = read_reg(REG_FIFO_STATUS) & 0b00111111;
    if (fifo_level == 0)
    return;
    
    uint8_t buf[7];
    while (fifo_level--) {
        read_multi(REG_DATAX0, buf, sizeof(buf));
        
        // get real 16-bit signed values
        int16_t x16 = (buf[1] << 8) | buf[0];
        int16_t y16 = (buf[3] << 8) | buf[2];
        int16_t z16 = (buf[5] << 8) | buf[4];

        // convert to 13-bit signed
        uint32_t x13 = x16 & 0x1FFF;
        uint32_t y13 = y16 & 0x1FFF;
        uint32_t z13 = z16 & 0x1FFF;
        
        // pack 3×13 bits
        uint64_t bits = (uint64_t)x13
        | ((uint64_t)y13 << 13)
        | ((uint64_t)z13 << 26);
        
        // output 6 bytes (little-endian)
        uint8_t out[6];
        out[0] = 255;
        out[1] = (uint8_t)(bits >> 0);
        out[2] = (uint8_t)(bits >> 8);
        out[3] = (uint8_t)(bits >> 16);
        out[4] = (uint8_t)(bits >> 24);
        out[5] = (uint8_t)(bits >> 32);
        
        Serial.write(out, 6);
    }

}

void setup() {
    pinMode(LED, OUTPUT);

#ifdef RT_PICO
    pinMode(SMPS_PWM, OUTPUT);
    digitalWrite(SMPS_PWM, HIGH); //enable PWM mode of SMPS regulator to reduce noise
#endif //RT_PICO

    Serial.begin(230400);

    pinMode(PIN_CS, OUTPUT);
#ifdef SPI_BITBANG
    pinMode(PIN_MOSI, OUTPUT);
    pinMode(PIN_MISO, INPUT);
    pinMode(PIN_SCK, OUTPUT);

    digitalWrite(PIN_SCK, HIGH);
#endif //SPI_BITBANG
    digitalWrite(PIN_CS, HIGH);
    delay(10);

#ifndef SPI_BITBANG
    ADXL_SPI.setMOSI(PIN_MOSI);
    ADXL_SPI.setMISO(PIN_MISO);
#ifdef RT_RP2040
    ADXL_SPI.setSCK(PIN_SCK);
#endif //RT_RP2040
#ifdef RT_BLUEPILL
    ADXL_SPI.setSCLK(PIN_SCK);
#endif //RT_BLUEPILL
    ADXL_SPI.begin();
    ADXL_SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE3));
#endif //SPI_BITBANG

    uint8_t id = read_reg(REG_DEVID);
    Serial.printf("ID = 0x%02X\r\n", id);

    write_reg(REG_DATA_FORMAT, 0b00001011); // 13 bit, ±16g
    write_reg(REG_BW_RATE, BW_3200HZ);      // 3200 Hz output rate
    write_reg(REG_FIFO_CTL, 0b10011111);    // stream mode, 32-sample FIFO
    write_reg(REG_POWER_CTL, 0b00001000);   // measurement mode
}

void loop() {
    drain_fifo();
    if(IS_CONNECTED)    //Light onboard led when USB serial is connected
        digitalWrite(LED, HIGH);
    else
        digitalWrite(LED, LOW);
}
