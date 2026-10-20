// Host tests: runs the real firmware (src/main.cpp) against a simulated accelerometer.
// Run with: pio test -e native_fly -e native_btt -e native_fysetc -e native_bluepill

#include <unity.h>

#include "../../src/main.cpp"
#include "accel_sim.h"

static AccelSim sim;

#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
static const AccelSim::Chip SIM_CHIP = AccelSim::ADXL345;
#else
static const AccelSim::Chip SIM_CHIP = AccelSim::LIS2DW12;
#endif

#ifdef SPI_BITBANG
static const bool BITBANG = true;
#else
static const bool BITBANG = false;
#endif

// UI scale: 13-bit samples at 3.9 mg/LSB
static const double G_PER_LSB = 0.0039;

struct Sample {
  int x, y, z;
};

struct Stream {
  std::vector<Sample> samples;
  std::vector<int> sample_rates;  // from sample-rate packets
};

// Same format as UI/src/screens/MeasureScreen/serial-protocol.ts
static Stream decode_stream(const std::vector<uint8_t>& bytes) {
  TEST_ASSERT_EQUAL_MESSAGE(0, bytes.size() % 6, "output is not whole 6-byte packets");
  Stream out;
  for (size_t i = 0; i < bytes.size(); i += 6) {
    const uint8_t* p = &bytes[i];
    if (p[0] == 0xFE) {
      TEST_ASSERT_EQUAL_HEX8_MESSAGE('R', p[1], "sample-rate packet tag");
      TEST_ASSERT_EQUAL_HEX8_MESSAGE(0xFF, p[2] ^ p[4], "sample-rate check byte (low)");
      TEST_ASSERT_EQUAL_HEX8_MESSAGE(0xFF, p[3] ^ p[5], "sample-rate check byte (high)");
      out.sample_rates.push_back(p[2] | (p[3] << 8));
      continue;
    }
    TEST_ASSERT_EQUAL_HEX8_MESSAGE(0xFF, p[0], "packet start marker");
    uint64_t bits = 0;
    for (int b = 0; b < 5; b++)
      bits |= (uint64_t)p[1 + b] << (8 * b);
    auto get13 = [&](int start) {
      int v = (int)((bits >> start) & 0x1FFF);
      return v & 0x1000 ? v - 0x2000 : v;
    };
    out.samples.push_back({get13(0), get13(13), get13(26)});
  }
  return out;
}

static std::vector<Sample> decode_samples(const std::vector<uint8_t>& bytes) {
  return decode_stream(bytes).samples;
}

static void assert_g(int lsb, double g) {
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  // same scale as the UI: only the chip's own rounding
  const double tol = G_PER_LSB * 0.51;
#else
  // 2 LIS2DW LSBs are 3.904 mg, not 3.9 mg (0.1% gain error), and the shift rounds down (1 LSB)
  const double tol = G_PER_LSB * 1.01 + 0.002 * std::fabs(g);
#endif
  TEST_ASSERT_DOUBLE_WITHIN(tol, g, lsb * G_PER_LSB);
}

static void assert_sample_g(const Sample& s, double x, double y, double z) {
  assert_g(s.x, x);
  assert_g(s.y, y);
  assert_g(s.z, z);
}

void setUp() {
  sim.reset(SIM_CHIP, PIN_CS, PIN_SCK, PIN_MOSI, PIN_MISO, BITBANG);
  mock::pins = &sim;
  mock::spi = &sim;
  Serial.written.clear();
  Serial.text.clear();
  setup();
}

void tearDown() {}

void test_init_configures_chip() {
  TEST_ASSERT_EQUAL_MESSAGE(0, sim.protocol_errors, "SPI protocol errors during setup");
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  TEST_ASSERT_EQUAL_HEX8(0x0B, sim.regs[0x31]);  // DATA_FORMAT: full resolution, ±16g
  TEST_ASSERT_EQUAL_HEX8(0x0F, sim.regs[0x2C]);  // BW_RATE: 3200 Hz
  TEST_ASSERT_EQUAL_HEX8(0x9F, sim.regs[0x38]);  // FIFO_CTL: stream mode
  TEST_ASSERT_EQUAL_HEX8(0x08, sim.regs[0x2D]);  // POWER_CTL: measure
  TEST_ASSERT_EQUAL_HEX8_MESSAGE(0x2D, sim.writes.back().first, "measurement must start last");
#else
  TEST_ASSERT_EQUAL_HEX8(0x06, sim.regs[0x21]);  // CTRL2: IF_ADD_INC, I2C off
  TEST_ASSERT_EQUAL_HEX8(0x34, sim.regs[0x25]);  // CTRL6: ±16g, low noise
  TEST_ASSERT_EQUAL_HEX8(0xC0, sim.regs[0x2E]);  // FIFO_CTRL: continuous mode
  TEST_ASSERT_EQUAL_HEX8(0x94, sim.regs[0x20]);  // CTRL1: 1600 Hz, high performance
  TEST_ASSERT_EQUAL_HEX8_MESSAGE(0x20, sim.writes.back().first, "measurement must start last");
#endif
}

void test_no_samples_when_fifo_empty() {
  loop();
  loop();
  TEST_ASSERT_EQUAL(0, decode_samples(Serial.written).size());
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
}

void test_reports_sample_rate() {
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  const int expected = 3200;
#else
  const int expected = 1600;
#endif
  // at boot
  Stream boot = decode_stream(Serial.written);
  TEST_ASSERT_EQUAL(1, boot.sample_rates.size());
  TEST_ASSERT_EQUAL(expected, boot.sample_rates[0]);

  // and again every second, for a UI that connects later
  Serial.written.clear();
  loop();
  mock::now_ms += 1000;
  loop();
  loop();
  Stream later = decode_stream(Serial.written);
  TEST_ASSERT_EQUAL(1, later.sample_rates.size());
  TEST_ASSERT_EQUAL(expected, later.sample_rates[0]);
}

void test_scaling_and_sign() {
  // includes > 8g to catch values wrapping in the 13-bit packing
  const double in[][3] = {{1, -1, 0.5}, {-2, 7.9, -15.9}, {12, -12, 0}, {0, 0, -1}};
  for (auto& s : in)
    sim.push_g(s[0], s[1], s[2]);
  loop();
  std::vector<Sample> out = decode_samples(Serial.written);
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
  TEST_ASSERT_EQUAL(0, sim.fifo.size());

  // one packet per sample, at the chip's own rate
  TEST_ASSERT_EQUAL(4, out.size());
  for (int i = 0; i < 4; i++)
    assert_sample_g(out[i], in[i][0], in[i][1], in[i][2]);
}

void test_full_fifo_drains_in_one_loop() {
  for (int i = 0; i < 32; i++)
    sim.push_g(i * 0.1, -i * 0.1, 1);
  loop();
  TEST_ASSERT_EQUAL(0, sim.fifo.size());
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
  TEST_ASSERT_EQUAL(32, decode_samples(Serial.written).size());
}


// Exact bytes, also checked by UI/src/screens/MeasureScreen/serial-protocol.test.ts
void test_packet_bytes_match_ui() {
  Serial.written.clear();
  send_sample(256, -256, 0);
  const std::vector<uint8_t> sample = {0xFF, 0x00, 0x01, 0xE0, 0x03, 0x00};
  TEST_ASSERT_EQUAL_HEX8_ARRAY(sample.data(), Serial.written.data(), 6);

  Serial.written.clear();
  send_sample_rate();
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  const std::vector<uint8_t> rate = {0xFE, 0x52, 0x80, 0x0C, 0x7F, 0xF3};
#else
  const std::vector<uint8_t> rate = {0xFE, 0x52, 0x40, 0x06, 0xBF, 0xF9};
#endif
  TEST_ASSERT_EQUAL(6, Serial.written.size());
  TEST_ASSERT_EQUAL_HEX8_ARRAY(rate.data(), Serial.written.data(), 6);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_init_configures_chip);
  RUN_TEST(test_no_samples_when_fifo_empty);
  RUN_TEST(test_reports_sample_rate);
  RUN_TEST(test_packet_bytes_match_ui);
  RUN_TEST(test_scaling_and_sign);
  RUN_TEST(test_full_fifo_drains_in_one_loop);
  return UNITY_END();
}
