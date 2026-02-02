import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';

function Scanner({ onScan, onClose }) {
    const scannerRef = useRef(null);
    const regionId = "html5qr-code-full-region";

    useEffect(() => {
        // Prevent double initialization in Strict Mode
        if (scannerRef.current) return;

        const config = {
            fps: 10,
            qrbox: { width: 250, height: 150 }, // Wider for barcodes
            aspectRatio: 1.0,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8
            ],
            // Use experimental features for better mobile support
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        };

        // Verbose false to reduce console spam
        const scanner = new Html5QrcodeScanner(regionId, config, false);
        scannerRef.current = scanner;

        scanner.render(
            (decodedText) => {
                // Success
                console.log("Scan success:", decodedText);
                scanner.clear();
                onScan(decodedText);
            },
            (error) => {
                // Error (scanning in progress, no code found yet)
                // console.warn(error); 
            }
        );

        // Cleanup
        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(err => console.error("Failed to clear scanner", err));
                scannerRef.current = null;
            }
        };
    }, [onScan]);

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md relative">
                <button
                    onClick={() => {
                        // Force cleanup if user closes manually
                        if (scannerRef.current) scannerRef.current.clear();
                        onClose();
                    }}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                >
                    Close
                </button>

                <h2 className="text-xl font-bold mb-4 text-center">Scan Barcode</h2>
                <div id={regionId} className="overflow-hidden rounded-lg bg-black min-h-[300px]" />
                <p className="text-center text-sm text-gray-500 mt-4">
                    Point camera at the UPC barcode on the back of the case.
                </p>
            </div>
        </div>
    );
}

export default Scanner;
