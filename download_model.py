import os
import urllib.request
import urllib.error
import zipfile
import sys
import time

MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-fr-0.22.zip"
MODEL_ZIP = "vosk-model-fr-0.22.zip"
MODEL_DIR = "model"

def download_with_resume(url, dest, retries=10):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            
            file_size = 0
            if os.path.exists(dest):
                file_size = os.path.getsize(dest)
                req.add_header('Range', f'bytes={file_size}-')
                
            response = urllib.request.urlopen(req, timeout=30)
            
            # If server ignores Range header, it will return 200 instead of 206
            if response.getcode() == 200 and file_size > 0:
                print("Server does not support resume. Restarting download...")
                file_size = 0
                mode = 'wb'
                total_size = int(response.headers.get('content-length', 0))
            else:
                mode = 'ab' if file_size > 0 else 'wb'
                total_size = int(response.headers.get('content-length', 0)) + file_size
                if file_size > 0:
                    print(f"Resuming download from {file_size / (1024*1024):.1f} MB...")

            with open(dest, mode) as out_file:
                while True:
                    buffer = response.read(8192 * 4)
                    if not buffer:
                        break
                    out_file.write(buffer)
                    file_size += len(buffer)
                    if total_size > 0:
                        percent = file_size * 100 / total_size
                        sys.stdout.write(f"\rDownloading: {percent:.1f}% ({file_size / (1024 * 1024):.1f} MB / {total_size / (1024 * 1024):.1f} MB)")
                    else:
                        sys.stdout.write(f"\rDownloading: {file_size / (1024 * 1024):.1f} MB")
                    sys.stdout.flush()
                    
            print("\nDownload complete.")
            return True
            
        except urllib.error.HTTPError as e:
            if e.code == 416: # Range not satisfiable, meaning file is fully downloaded
                print("\nFile fully downloaded.")
                return True
            print(f"\nHTTP Error: {e.code} - {e.reason}")
        except Exception as e:
            print(f"\nDownload interrupted: {e}")
            
        print(f"Retrying in 5 seconds... (Attempt {attempt+1}/{retries})")
        time.sleep(5)
        
    return False

def main():
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR)

    zip_path = os.path.join(MODEL_DIR, MODEL_ZIP)
    
    if not os.path.exists(os.path.join(MODEL_DIR, "vosk-model-fr-0.22")):
        print(f"Downloading model from {MODEL_URL}...")
        
        success = download_with_resume(MODEL_URL, zip_path)
        if not success:
            print("Failed to download the model after multiple attempts.")
            sys.exit(1)
        
        print("Extracting model (this might take a minute)...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(MODEL_DIR)
        print("Extraction complete.")
        
        print("Cleaning up zip file...")
        os.remove(zip_path)
    else:
        print("Model already exists in the 'model' directory.")
        
    print("All done! You can now run main.py.")

if __name__ == "__main__":
    main()
