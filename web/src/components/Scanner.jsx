import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

function Scanner({ onScan, onClose }) {
    const scannerRef = useRef(null);
    const regionId = "html5qr-code-full-region";

    useEffect(() => {
        // Prevent double initialization
        if (scannerRef.current) return;

        const config = {
            fps: 15, // Higher FPS
            qrbox: { width: 300, height: 150 }, // Wider box
            // Remove fixed aspect ratio to use full camera field
            videoConstraints: {
                facingMode: "environment",
                width: { ideal: 1280 }, // Prefer HD
                height: { ideal: 720 }
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
                console.log("Scan success:", decodedText);
                // Don't clear manually here. 
                // Just trigger callback -> React unmounts -> cleanup() runs.
                onScan(decodedText);
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
