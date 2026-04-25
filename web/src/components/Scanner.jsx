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

function Scanner({ onScan, onCoverPhoto, canUseCover, coverUsage, onClose }) {
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
  const [tab, setTab] = useState('barcode');
  const coverInputRef = useRef(null);

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
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-sm">
          Close
        </button>

        <h2 className="text-xl font-bold mb-4 text-center">Add Movie</h2>

        {/* Tab switcher */}
        <div className="flex rounded-lg bg-gray-900 p-1 mb-4 gap-1">
          <button
            onClick={() => setTab('barcode')}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${tab === 'barcode' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Barcode
          </button>
          <button
            onClick={() => setTab('cover')}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${tab === 'cover' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Cover Photo {canUseCover ? '' : '🔒'}
          </button>
        </div>

        {tab === 'barcode' && (
          <>
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
                />
                <button type="submit" className="bg-blue-600 px-4 py-2 rounded text-white">Go</button>
              </form>
            </div>
          </>
        )}

        {tab === 'cover' && (
          <div className="flex flex-col items-center gap-4 py-6">
            {canUseCover ? (
              <>
                <p className="text-sm text-gray-400 text-center">
                  Take a photo of the disc cover — Claude will identify the movie.
                </p>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onCoverPhoto(file);
                  }}
                />
                <button
                  onClick={() => coverInputRef.current?.click()}
                  className="bg-blue-600 hover:bg-blue-500 px-8 py-4 rounded-xl font-bold text-lg transition-colors"
                >
                  📸 Take Photo
                </button>
                <p className="text-xs text-gray-600 text-center">
                  Works on damaged barcodes, import editions, and unusual packaging.
                </p>
                {coverUsage && coverUsage.scans > 0 && (
                  <p className="text-xs text-gray-600 text-center">
                    ~{coverUsage.scans} scan{coverUsage.scans !== 1 ? 's' : ''} this month · est. ${coverUsage.cost.toFixed(3)}
                  </p>
                )}
              </>
            ) : (
              <div className="text-center space-y-3 py-4">
                <p className="text-4xl">🔒</p>
                <p className="text-gray-300 font-semibold">Anthropic API key required</p>
                <p className="text-sm text-gray-500">Add your key in Settings to enable cover photo identification.</p>
                <button onClick={onClose} className="mt-2 text-blue-400 text-sm underline">Go to Settings</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Scanner;
