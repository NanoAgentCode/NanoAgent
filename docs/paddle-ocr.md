# PaddleOCR OCR Tool

NanoAgent exposes a local `ocr_image` agent tool for extracting text from project images with PaddleOCR PP-OCRv6 small. The model files are intentionally not bundled into the main app so the installer stays light; PaddleOCR prepares or downloads the model assets in the user's local Python environment.

## Runtime Dependency

Install the local OCR runtime from the environment settings page, or run:

```powershell
python -m pip install --user paddleocr paddlepaddle
```

NanoAgent checks `PATH`, the current Python `sysconfig.get_path("scripts")` directory, and `NANO_AGENT_PADDLEOCR_BIN`. If the executable still cannot be found, set `NANO_AGENT_PADDLEOCR_BIN` to the full `paddleocr.exe` path before starting NanoAgent.

## Agent Tool

The model can request OCR with:

```xml
<tool_call name="ocr_image">
  <path>screenshots/page.png</path>
  <output_format>text</output_format>
</tool_call>
```

Arguments:

- `path`: required project-relative image path.
- `output_format`: optional, `text` or `raw`; defaults to `text`.

The backend constrains input to files inside the active project and accepts `png`, `jpg`, `jpeg`, `bmp`, `webp`, `tif`, and `tiff` images up to 25MB.

## Model Profile

The default CLI invocation uses:

- `PP-OCRv6_small_det`
- `PP-OCRv6_small_rec`
- CPU execution
- document orientation, unwarping, and textline orientation disabled for lightweight default behavior

This keeps the built-in path suitable for local desktop OCR while leaving room to add a high-accuracy optional profile later.
