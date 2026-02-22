import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

function Scanner({ onScan, onClose }) {
    const scannerRef = useRef(null);
    const regionId = "html5qr-code-full-region";
    const lastValueRef = useRef("");
    const streakRef = useRef(0);
    const acceptedAtRef = useRef(0);
    const [hint, setHint] = useState("Align barcode inside the frame");

    const normalizeCode = (value) => {
        const trimmed = (value || "").trim();
        if (!trimmed) return "";
        const digits = trimmed.replace(/\D/g, "");
        return digits.length >= 8 ? digits : trimmed;
    };

    useEffect(() => {
        // Prevent double initialization
        if (scannerRef.current) return;

        const config = {
            fps: 12,
            qrbox: { width: 320, height: 240 }, // Larger scanning area
            videoConstraints: {
                facingMode: "environment",
                width: { ideal: 1920 }, // Prefer Full HD
                height: { ideal: 1080 }
            },
            formatsToSupport: [
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8
            ],
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        };

        const scanner = new Html5QrcodeScanner(regionId, config, false);
        scannerRef.current = scanner;

        scanner.render(
            (decodedText) => {
                const now = Date.now();
                if (now - acceptedAtRef.current < 2000) return;

                const normalized = normalizeCode(decodedText);
                if (!normalized) return;

                if (normalized === lastValueRef.current) {
                    streakRef.current += 1;
                } else {
                    lastValueRef.current = normalized;
                    streakRef.current = 1;
                }

                const requiredStreak = /^\d{8,14}$/.test(normalized) ? 2 : 1;
                setHint(`Reading... ${streakRef.current}/${requiredStreak}`);

                if (streakRef.current >= requiredStreak) {
                    acceptedAtRef.current = now;
                    setHint(`Detected: ${normalized}`);
                    onScan(normalized);
                }
            },
            (error) => {
                // Ignore errors
            }
        );

        // Cleanup
        return () => {
            if (scannerRef.current) {
                // Use clear() which stops camera and removes UI
                scannerRef.current.clear().catch(err => console.warn("Scanner cleanup warning:", err));
                scannerRef.current = null;
            }
        };
    }, [onScan]);

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md relative">
                <button
                    onClick={() => {
                        // User manual close
                        onClose();
                    }}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    Close
                </button>

                <h2 className="text-xl font-bold mb-4 text-center">Scan Barcode</h2>
                <div id={regionId} className="overflow-hidden rounded-lg bg-black min-h-[300px]" />
                <p className="mt-3 text-xs text-center text-gray-400">{hint}</p>

                <div className="mt-4 text-center">
                    <p className="text-sm text-gray-500 mb-2">
                        Camera struggling? Type UPC or Title:
                    </p>
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
                            placeholder="e.g. Inception"
                            autoFocus
                        />
                        <button
                            type="submit"
                            className="bg-blue-600 px-4 py-2 rounded text-white"
                        >
                            Go
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default Scanner;
