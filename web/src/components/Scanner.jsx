import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

const REGION_ID = 'html5qr-code-full-region';
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
];

function Scanner({ onScan, onClose }) {
  const html5QrRef = useRef(null);
  const mountedRef = useRef(false);
  const acceptedAtRef = useRef(0);
  const lastValueRef = useRef('');
  const streakRef = useRef(0);
  const failuresRef = useRef(0);
  const modeRef = useRef('fast');
  const switchedRef = useRef(false);
  const startAtRef = useRef(0);
  const hintTickRef = useRef(0);

  const [hint, setHint] = useState('Starting camera...');

  const normalizeCode = (value) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 8 ? digits : trimmed;
  };

  const emitFeedback = () => {
    try {
      if (navigator?.vibrate) navigator.vibrate(35);
    } catch (_) {
      // ignore
    }

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.02;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch (_) {
      // ignore
    }
  };

  const fastConfig = {
    fps: 15,
    qrbox: { width: 300, height: 180 },
    formatsToSupport: SCAN_FORMATS,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };

  const slowConfig = {
    fps: 10,
    formatsToSupport: SCAN_FORMATS,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };

  const startMode = async (mode) => {
    const scanner = html5QrRef.current;
    if (!scanner) return;

    modeRef.current = mode;
    startAtRef.current = Date.now();
    failuresRef.current = 0;

    const config = mode === 'fast' ? fastConfig : slowConfig;
    setHint(mode === 'fast' ? 'Scanning (fast mode)...' : 'Scanning (full-frame mode)...');

    await scanner.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        if (!mountedRef.current) return;
        const now = Date.now();
        if (now - acceptedAtRef.current < 1600) return;

        const normalized = normalizeCode(decodedText);
        if (!normalized) return;

        if (normalized === lastValueRef.current) streakRef.current += 1;
        else {
          lastValueRef.current = normalized;
          streakRef.current = 1;
        }

        const requiredStreak = /^\d{8,14}$/.test(normalized) ? 2 : 1;
        setHint(`Reading ${modeRef.current} mode... ${streakRef.current}/${requiredStreak}`);

        if (streakRef.current >= requiredStreak) {
          acceptedAtRef.current = now;
          emitFeedback();
          setHint(`Detected: ${normalized}`);
          onScan(normalized);
        }
      },
      () => {
        failuresRef.current += 1;
        const now = Date.now();

        if (modeRef.current === 'fast' && !switchedRef.current && now - startAtRef.current > 1200) {
          switchedRef.current = true;
          setHint('Switching to full-frame scan...');
          scanner
            .stop()
            .then(() => startMode('slow'))
            .catch(() => startMode('slow'));
          return;
        }

        if (now - hintTickRef.current > 1200) {
          hintTickRef.current = now;
          if (failuresRef.current < 8) setHint('Center barcode and hold still for 1 second.');
          else if (failuresRef.current < 20) setHint('Move closer and reduce glare.');
          else setHint('Try slight tilt or type UPC manually below.');
        }
      }
    );
  };

  useEffect(() => {
    mountedRef.current = true;
    const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    html5QrRef.current = scanner;

    startMode('fast').catch((err) => {
      console.error('Scanner start failed', err);
      setHint('Camera failed to start. Use manual entry below.');
    });

    return () => {
      mountedRef.current = false;
      const active = html5QrRef.current;
      html5QrRef.current = null;
      if (active) {
        active.stop().catch(() => null).finally(() => active.clear().catch(() => null));
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          Close
        </button>

        <h2 className="text-xl font-bold mb-4 text-center">Scan Barcode</h2>
        <div id={REGION_ID} className="overflow-hidden rounded-lg bg-black min-h-[300px]" />
        <p className="mt-3 text-xs text-center text-gray-400">{hint}</p>

        <div className="mt-4 text-center">
          <p className="text-sm text-gray-500 mb-2">Camera struggling? Type UPC or Title:</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const val = e.target.elements.manualCode.value;
              if (val) onScan(val);
            }}
            className="flex gap-2"
          >
            <input
              name="manualCode"
              className="flex-1 bg-gray-700 text-white p-2 rounded"
              placeholder="e.g. 883929800815 or Inception"
              autoFocus
            />
            <button type="submit" className="bg-blue-600 px-4 py-2 rounded text-white">
              Go
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Scanner;
