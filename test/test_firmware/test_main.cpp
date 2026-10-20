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

// Same decoding as UI/src/screens/MeasureScreen/serial-worker.ts
static std::vector<Sample> decode_packets(const std::vector<uint8_t>& bytes) {
  TEST_ASSERT_EQUAL_MESSAGE(0, bytes.size() % 6, "output is not whole 6-byte packets");
  std::vector<Sample> out;
  for (size_t i = 0; i < bytes.size(); i += 6) {
    TEST_ASSERT_EQUAL_HEX8_MESSAGE(255, bytes[i], "packet start marker");
    uint64_t bits = 0;
    for (int b = 0; b < 5; b++)
      bits |= (uint64_t)bytes[i + 1 + b] << (8 * b);
    auto get13 = [&](int start) {
      int v = (int)((bits >> start) & 0x1FFF);
      return v & 0x1000 ? v - 0x2000 : v;
    };
    out.push_back({get13(0), get13(13), get13(26)});
  }
  return out;
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

void test_no_output_when_fifo_empty() {
  loop();
  loop();
  TEST_ASSERT_EQUAL(0, Serial.written.size());
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
}

void test_scaling_and_sign() {
  // includes > 8g to catch values wrapping in the 13-bit packing
  const double in[][3] = {{1, -1, 0.5}, {-2, 7.9, -15.9}, {12, -12, 0}, {0, 0, -1}};
  for (auto& s : in)
    sim.push_g(s[0], s[1], s[2]);
  loop();
  std::vector<Sample> out = decode_packets(Serial.written);
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
  TEST_ASSERT_EQUAL(0, sim.fifo.size());

#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  TEST_ASSERT_EQUAL(4, out.size());
  for (int i = 0; i < 4; i++)
    assert_sample_g(out[i], in[i][0], in[i][1], in[i][2]);
#else
  // 2x upsampled: sample, then midpoint + sample for each following one
  TEST_ASSERT_EQUAL(7, out.size());
  for (int i = 0; i < 4; i++)
    assert_sample_g(out[2 * i], in[i][0], in[i][1], in[i][2]);
#endif
}

void test_full_fifo_drains_in_one_loop() {
  for (int i = 0; i < 32; i++)
    sim.push_g(i * 0.1, -i * 0.1, 1);
  loop();
  TEST_ASSERT_EQUAL(0, sim.fifo.size());
  TEST_ASSERT_EQUAL(0, sim.protocol_errors);
  std::vector<Sample> out = decode_packets(Serial.written);
#if ACCEL_CHIP == ACCEL_CHIP_ADXL345
  TEST_ASSERT_EQUAL(32, out.size());
#else
  TEST_ASSERT_EQUAL(63, out.size());
#endif
}

#if ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
void test_lis2dw_upsamples_to_3200hz() {
  // two drains: the midpoint must also bridge the gap between FIFO reads
  sim.push_g(0, 0, 0);
  sim.push_g(1, -1, 2);
  loop();
  sim.push_g(3, -3, 0);
  loop();
  std::vector<Sample> out = decode_packets(Serial.written);
  TEST_ASSERT_EQUAL(5, out.size());
  assert_sample_g(out[0], 0, 0, 0);
  assert_sample_g(out[1], 0.5, -0.5, 1);  // midpoint
  assert_sample_g(out[2], 1, -1, 2);
  assert_sample_g(out[3], 2, -2, 1);  // midpoint across loop() calls
  assert_sample_g(out[4], 3, -3, 0);
}
#endif

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_init_configures_chip);
  RUN_TEST(test_no_output_when_fifo_empty);
  RUN_TEST(test_scaling_and_sign);
  RUN_TEST(test_full_fifo_drains_in_one_loop);
#if ACCEL_CHIP == ACCEL_CHIP_LIS2DW12
  RUN_TEST(test_lis2dw_upsamples_to_3200hz);
#endif
  return UNITY_END();
}
