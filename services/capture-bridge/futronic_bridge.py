"""
Futronic Capture Bridge (Python)

Windows loading notes:
- WinError 126 on ftrScanAPI.dll usually means a *dependency* DLL is missing (not this file).
  Copy all DLLs from the Futronic SDK Bin folder next to ftrScanAPI.dll, or set FTRONIC_DLL_DIR
  to that folder (must contain ftrScanAPI.dll and its siblings).
- WinError 193 often means 32-bit vs 64-bit mismatch (Python arch must match the SDK DLLs).
"""

import base64
import os
import platform
import time
import ctypes
import sys
import threading
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
import io
try:
    from PIL import Image
except ImportError:
    Image = None

app = Flask(__name__)
CORS(app)

# Global lock to prevent concurrent USB access
scanner_lock = threading.Lock()

class FTRSCAN_IMAGE_SIZE(ctypes.Structure):
    _fields_ = [
        ("nWidth", ctypes.c_int),
        ("nHeight", ctypes.c_int)
    ]

_BRIDGE_DIR = Path(__file__).resolve().parent

_LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR = 0x00000100
_LOAD_LIBRARY_SEARCH_DEFAULT_DIRS = 0x00001000

_FTR_DIAG: dict = {
    "python": None,
    "tried_paths": [],
    "loaded_from": None,
    "error": None,
    "hints": [],
}


def _win_dll_kwargs():
    if sys.platform != "win32" or sys.version_info < (3, 8):
        return {}
    return {
        "winmode": _LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | _LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
    }


def _candidate_dll_dirs():
    out = []
    env = os.environ.get("FTRONIC_DLL_DIR", "").strip()
    if env:
        out.append(Path(env))
    out.append(_BRIDGE_DIR)
    if getattr(sys, 'frozen', False):
        out.append(Path(sys.executable).parent)
    return out


def _load_futronic_dll():
    global ftr_dll
    ftr_dll = None
    _FTR_DIAG["python"] = f"{platform.python_implementation()} {platform.python_version()} ({platform.architecture()[0]})"
    _FTR_DIAG["tried_paths"] = []
    _FTR_DIAG["loaded_from"] = None
    _FTR_DIAG["error"] = None
    _FTR_DIAG["hints"] = []

    if sys.platform != "win32":
        try:
            ftr_dll = ctypes.cdll.LoadLibrary("libftrScanAPI.so")
            _FTR_DIAG["loaded_from"] = "libftrScanAPI.so"
            return True
        except OSError as e:
            _FTR_DIAG["error"] = f"{type(e).__name__}: {e}"
            return False

    dll_name = "ftrScanAPI.dll"
    last_err = None
    for base in _candidate_dll_dirs():
        dll_path = base / dll_name
        _FTR_DIAG["tried_paths"].append(str(dll_path.resolve()))
        if not dll_path.is_file():
            continue
        try:
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(base.resolve()))
            ftr_dll = ctypes.WinDLL(str(dll_path.resolve()), **_win_dll_kwargs())
            _FTR_DIAG["loaded_from"] = str(dll_path.resolve())
            last_err = None
            break
        except OSError as e:
            last_err = e
            ftr_dll = None

    if ftr_dll is None:
        msg_parts = []
        if last_err is not None:
            msg_parts.append(f"{type(last_err).__name__}: {last_err}")
            winerr = getattr(last_err, "winerror", None)
            if winerr == 126:
                _FTR_DIAG["hints"].append(
                    "WinError 126: Windows often reports this when a *dependency* of ftrScanAPI.dll is missing. "
                    "Copy every DLL from the Futronic SDK Bin folder into capture-bridge (or set FTRONIC_DLL_DIR to that Bin path)."
                )
            elif winerr == 193:
                _FTR_DIAG["hints"].append(
                    "WinError 193: wrong CPU architecture. Use 64-bit Python with x64 Futronic DLLs (or 32-bit Python with x86 SDK)."
                )
        else:
            msg_parts.append(f"No {dll_name} file at FTRONIC_DLL_DIR or in {_BRIDGE_DIR}")
        _FTR_DIAG["error"] = " ".join(msg_parts)
        print(f"Warning: Futronic DLL load failed — {_FTR_DIAG['error']}")
        return False

    return True


ftr_dll = None
if _load_futronic_dll():
    ftr_dll.ftrScanOpenDevice.restype = ctypes.c_void_p
    ftr_dll.ftrScanOpenDevice.argtypes = []

    ftr_dll.ftrScanCloseDevice.restype = None
    ftr_dll.ftrScanCloseDevice.argtypes = [ctypes.c_void_p]

    ftr_dll.ftrScanGetImageSize.restype = ctypes.c_int
    ftr_dll.ftrScanGetImageSize.argtypes = [ctypes.c_void_p, ctypes.POINTER(FTRSCAN_IMAGE_SIZE)]

    ftr_dll.ftrScanGetFrame.restype = ctypes.c_int
    ftr_dll.ftrScanGetFrame.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]

    ftr_dll.ftrScanGetImage.restype = ctypes.c_int
    ftr_dll.ftrScanGetImage.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]

    ftr_dll.ftrScanGetLastError.restype = ctypes.c_int
    ftr_dll.ftrScanGetLastError.argtypes = []

def capture_futronic_image_bytes():
    if ftr_dll is None:
        raise RuntimeError("ftrScanAPI.dll is not loaded. Please install the Futronic SDK.")

    with scanner_lock:
        device_handle = ftr_dll.ftrScanOpenDevice()
        if not device_handle:
            raise RuntimeError("Failed to open Futronic device. Is it plugged in?")

        try:
            # Get Image Size
            c_size = FTRSCAN_IMAGE_SIZE()
            res = ftr_dll.ftrScanGetImageSize(device_handle, ctypes.byref(c_size))
            if not res or c_size.nWidth <= 0 or c_size.nHeight <= 0:
                width = 320
                height = 480
            else:
                width = c_size.nWidth
                height = c_size.nHeight
                
            buffer_size = width * height
            image_buffer = (ctypes.c_ubyte * buffer_size)()
            
            print("Waiting for finger...")
            
            finger_touched = False
            for _ in range(300): # 30 seconds of polling
                ftr_dll.ftrScanGetFrame(device_handle, 0, ctypes.byref(image_buffer))
                
                center_idx = (height // 2) * width + (width // 2)
                dark_pixels = 0
                for i in range(-10, 10):
                    for j in range(-10, 10):
                        idx = center_idx + (i * width) + j
                        if 0 <= idx < buffer_size:
                            if image_buffer[idx] < 200:
                                dark_pixels += 1
                                
                if dark_pixels > 20:
                    finger_touched = True
                    break
                    
                time.sleep(0.1)
                
            if not finger_touched:
                raise RuntimeError("Capture timed out. No finger detected.")
                
            print("Finger detected. Waiting for firm press...")
            time.sleep(0.8)
            
            result = ftr_dll.ftrScanGetImage(device_handle, 4, ctypes.byref(image_buffer))
            
            if not result:
                err_code = ftr_dll.ftrScanGetLastError()
                raise RuntimeError(f"Capture failed. ftrScanGetImage returned False. Error code: {err_code}")

            print("Fingerprint captured successfully!")
            
            # Make a safe Python copy of the bytes before the C buffer is destroyed
            final_bytes = bytes(image_buffer)
            return final_bytes, width, height

        finally:
            # Ensure the device is cleanly closed
            ftr_dll.ftrScanCloseDevice(device_handle)
            # Give the USB bus a tiny moment to reset before any future requests
            time.sleep(0.2)

@app.route('/health', methods=['GET'])
def health():
    if ftr_dll is None:
        err = _FTR_DIAG.get("error") or "ftrScanAPI.dll could not be loaded."
        hints = _FTR_DIAG.get("hints") or []
        if hints:
            err = f"{err} {' '.join(hints)}"
        body = {
            "status": "error",
            "message": err,
            "detail": {k: v for k, v in _FTR_DIAG.items() if v is not None and v != []},
        }
        return jsonify(body), 500

    return jsonify({
        "status": "ok",
        "vendor": "futronic",
        "scanner": "Futronic FS80H (or compatible)",
        "loaded_from": _FTR_DIAG.get("loaded_from"),
    })

@app.route('/capture', methods=['POST'])
def capture():
    try:
        image_bytes, width, height = capture_futronic_image_bytes()
        
        # Default to raw if PIL not available
        final_b64 = base64.b64encode(image_bytes).decode('utf-8')
        final_format = "raw_gray8"
        
        if Image:
            try:
                # Convert raw_gray8 to PNG
                img = Image.frombytes('L', (width, height), image_bytes)
                buf = io.BytesIO()
                img.save(buf, format='PNG')
                final_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
                final_format = "png"
                print("Converted raw fingerprint to PNG successfully.")
            except Exception as pe:
                print(f"Pillow conversion failed, falling back to raw: {pe}")
        
        return jsonify({
            "vendor": "futronic",
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "width": width,
            "height": height,
            "dpi": 500,
            "format": final_format, 
            "imageBase64": final_b64
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    from waitress import serve
    print("Starting Futronic Capture Bridge on http://127.0.0.1:5055")
    serve(app, host='127.0.0.1', port=5055)
