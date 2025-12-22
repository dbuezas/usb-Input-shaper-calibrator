import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import Spectrogram from './Spectrogram';
import { SerialService } from './serial-service';

type PeakInfo = {
  frequency: number;
  magnitude: number;
};

const SAMPLE_RATE_HZ = 1600;
const MAX_DISPLAY_FREQUENCY = SAMPLE_RATE_HZ / 2;
const MIN_FREQUENCY_SLIDER = 0;
const MIN_SLIDER_GAP = 1;

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [adxlData, setAdxlData] = useState<Int16Array<ArrayBufferLike>>();
  const [status, setStatus] = useState('Disconnected');
  const [frequency, setFrequency] = useState(0);
  const [minFrequency, setMinFrequency] = useState(5);
  const [maxFrequency, setMaxFrequency] = useState(150);
  const [selectedAxis, setSelectedAxis] = useState<'x' | 'y' | 'z'>('x');
  const [peakInfoByAxis, setPeakInfoByAxis] = useState<Record<'x' | 'y' | 'z', PeakInfo | null>>({
    x: null,
    y: null,
    z: null,
  });
  const serialServiceRef = useRef<SerialService | null>(null);

  useEffect(() => {
    serialServiceRef.current = new SerialService(
      (data) => setAdxlData(data),
      (freq) => setFrequency(freq),
      (stat) => setStatus(stat)
    );

    return () => {
      if (serialServiceRef.current) {
        serialServiceRef.current.disconnect();
      }
    };
  }, []);

  const handlePeakUpdate = useCallback((info: PeakInfo) => {
    setPeakInfoByAxis((prev) => ({ ...prev, [selectedAxis]: info }));
  },[selectedAxis]);

  const connect = async () => {
    const success = await serialServiceRef.current?.connect();
    if (success) {
      setIsConnected(true);
    }
  };

  const disconnect = async () => {
    await serialServiceRef.current?.disconnect();
    setIsConnected(false);
    setPeakInfoByAxis({ x: null, y: null, z: null });
  };

  const handleMinFrequencyChange = (value: number) => {
    const clampedValue = Math.min(
      value,
      Math.max(MIN_FREQUENCY_SLIDER, maxFrequency - MIN_SLIDER_GAP)
    );
    setMinFrequency(Math.max(MIN_FREQUENCY_SLIDER, clampedValue));
  };

  const handleMaxFrequencyChange = (value: number) => {
    const clampedValue = Math.max(
      value,
      Math.min(MAX_DISPLAY_FREQUENCY, minFrequency + MIN_SLIDER_GAP)
    );
    setMaxFrequency(Math.min(MAX_DISPLAY_FREQUENCY, clampedValue));
  };

  const currentPeak = peakInfoByAxis[selectedAxis];

  return (
    <div className="app">
      <h1>ADXL Resonance Analyzer</h1>
      <div className="status">
        <p>
          Status: <span className={isConnected ? 'connected' : 'disconnected'}>{status}</span>
        </p>
      </div>
      <div className="controls">
        {!isConnected ? (
          <button onClick={connect} className="connect-btn">
            Connect to Device
          </button>
        ) : (
          <button onClick={disconnect} className="disconnect-btn">
            Disconnect
          </button>
        )}
      </div>
      <div className="data-display">
        <div className="axis">
          <h2>X Axis</h2>
          <div className="value">{adxlData?.[0]}</div>
        </div>
        <div className="axis">
          <h2>Y Axis</h2>
          <div className="value">{adxlData?.[1]}</div>
        </div>
        <div className="axis">
          <h2>Z Axis</h2>
          <div className="value">{adxlData?.[2]}</div>
        </div>
        <div className="axis">
          <h2>Frequency</h2>
          <div className="value">{frequency.toFixed(1)} Hz</div>
        </div>
      </div>

      {isConnected && (
        <div className="spectrogram-section">
          <div className="controls-row">
            <div className="axis-selector">
              <label>Axis: </label>
              <select
                value={selectedAxis}
                onChange={(e) => setSelectedAxis(e.target.value as 'x' | 'y' | 'z')}
              >
                <option value="x">X Axis</option>
                <option value="y">Y Axis</option>
                <option value="z">Z Axis</option>
              </select>
            </div>
            {/* Sample rate fixed in firmware, UI control removed */}
          </div>
          <div className="frequency-controls">
            <div className="slider-control">
              <label htmlFor="min-frequency-slider">Min Frequency: {minFrequency} Hz</label>
              <input
                id="min-frequency-slider"
                type="range"
                min={MIN_FREQUENCY_SLIDER}
                max={MAX_DISPLAY_FREQUENCY}
                step={1}
                value={minFrequency}
                onChange={(e) => handleMinFrequencyChange(Number(e.target.value))}
              />
            </div>
            <div className="slider-control">
              <label htmlFor="max-frequency-slider">Max Frequency: {maxFrequency} Hz</label>
              <input
                id="max-frequency-slider"
                type="range"
                min={MIN_FREQUENCY_SLIDER}
                max={MAX_DISPLAY_FREQUENCY}
                step={1}
                value={maxFrequency}
                onChange={(e) => handleMaxFrequencyChange(Number(e.target.value))}
              />
            </div>
          </div>
          <Spectrogram
            selectedAxis={selectedAxis}
            width={800}
            height={300}
            onPeakUpdate={handlePeakUpdate}
            minFrequency={minFrequency}
            maxFrequency={maxFrequency}
            onSetRange={(min, max) => serialServiceRef.current?.setRange(min, max)}
          />
        </div>
      )}

      <div className="info">
        <div className="peak-info">
          <span>Peak ({selectedAxis.toUpperCase()}): </span>
          <strong>
            {currentPeak
              ? `${currentPeak.frequency.toFixed(1)} Hz @ ${currentPeak.magnitude.toFixed(1)}`
              : '—'}
          </strong>
        </div>
        <p>Make sure your device is connected and running the firmware.</p>
        <p>This app requires a browser that supports the Web Serial API (Chrome, Edge, Opera).</p>
      </div>
    </div>
  );
}

export default App;
