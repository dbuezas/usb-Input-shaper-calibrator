#pragma once

// Minimal Arduino API for running the firmware on the host (see test/test_firmware).
// Pin writes and reads are forwarded to `mock::pins`, which the tests point at a simulated accelerometer.

#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1

#define LED_BUILTIN 25
// STM32 pin names used by the Bluepill config
enum { PA4 = 104, PA5, PA6, PA7 };

namespace mock {
  struct PinHook {
    virtual void write(int pin, int val) = 0;
    virtual int read(int pin) = 0;
  };
  inline PinHook* pins = nullptr;
  inline uint32_t now_ms = 0;
}  // namespace mock

inline void pinMode(int, int) {}
inline void digitalWrite(int pin, int val) {
  if (mock::pins) mock::pins->write(pin, val);
}
inline int digitalRead(int pin) {
  return mock::pins ? mock::pins->read(pin) : LOW;
}
inline void delay(uint32_t ms) {
  mock::now_ms += ms;
}
inline void delayMicroseconds(uint32_t) {}
inline uint32_t millis() {
  return mock::now_ms;
}

class MockSerial {
 public:
  std::vector<uint8_t> written;  // binary output (sample packets)
  std::string text;              // printf output

  void begin(unsigned long) {}
  size_t write(const uint8_t* buf, size_t len) {
    written.insert(written.end(), buf, buf + len);
    return len;
  }
  int printf(const char* fmt, ...) {
    char buf[256];
    va_list args;
    va_start(args, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    text += buf;
    return n;
  }
  bool dtr() { return true; }
  explicit operator bool() const { return true; }
};

inline MockSerial Serial;
