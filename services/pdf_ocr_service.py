import io, os, re, json
from typing import Any
import cv2, fitz, numpy as np, pytesseract
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont

app = FastAPI(title="Nexsa Bills PDF OCR reconstruction")

def load_font(size: int):
    for path in ["/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"]:
        if os.path.exists(path):
            try: return ImageFont.truetype(path, size=size)
            except Exception: pass
    return ImageFont.load_default()

@app.get("/health")
def health():
    return {"ok": True, "service": "pdf-ocr-reconstruction"}

@app.post("/render")
async def render(pdf: UploadFile = File(...), values: str = Form(...), fields: str = Form(...)):
    try:
        field_values: dict[str, Any] = json.loads(values)
        field_list = json.loads(fields)
        if not isinstance(field_values, dict) or not isinstance(field_list, list): raise ValueError("Invalid fields")
        raw = await pdf.read()
        if not raw.startswith(b"%PDF-"): raise ValueError("Invalid PDF")
        source = fitz.open(stream=raw, filetype="pdf")
        output = fitz.open()
        editable = [f for f in field_list if isinstance(f, dict) and f.get("editable") and f.get("bbox") and f.get("key") in field_values]
        if not editable: raise HTTPException(422, "No fields with positions are available.")
        for page_index, source_page in enumerate(source):
            scale = 2.5
            pix = source_page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            arr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            page_fields = [f for f in editable if int(f.get("page", 1)) - 1 == page_index]
            masks = np.zeros(arr.shape[:2], dtype=np.uint8)
            rects = []
            for f in page_fields:
                b = f.get("bbox") or {}
                x = int(max(0, min(999, float(b.get("x", 0)))) * arr.shape[1] / 1000)
                y = int(max(0, min(999, float(b.get("y", 0)))) * arr.shape[0] / 1000)
                w = int(max(1, min(1000, float(b.get("width", 1))) * arr.shape[1] / 1000)
                h = int(max(1, min(1000, float(b.get("height", 1))) * arr.shape[0] / 1000)
                x2, y2 = min(arr.shape[1], x + w), min(arr.shape[0], y + h)
                if x2 <= x or y2 <= y: continue
                pad = max(2, int(scale * 1.5))
                x, y, x2, y2 = max(0, x-pad), max(0, y-pad), min(arr.shape[1], x2+pad), min(arr.shape[0], y2+pad)
                cv2.rectangle(masks, (x, y), (x2, y2), 255, -1)
                rects.append((f, x, y, x2, y2))
            if rects: arr = cv2.inpaint(arr, masks, 5, cv2.INPAINT_TELEA)
            image = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(image)
            for f, x, y, x2, y2 in rects:
                value = re.sub(r"[\r\n\t]+", " ", str(field_values.get(f.get("key"), "")))[:180]
                if not value: continue
                box_h = max(8, y2-y)
                font = load_font(max(9, min(36, int(box_h * 0.72))))
                max_width = max(10, x2-x)
                while font.size > 7 and draw.textbbox((0, 0), value, font=font)[2] > max_width: font = load_font(font.size - 1)
                draw.text((x+2, y+max(0, (box_h-font.size)//2)), value, font=font, fill=(25, 25, 25))
            png = io.BytesIO()
            image.save(png, format="PNG", optimize=True)
            out_page = output.new_page(width=source_page.rect.width, height=source_page.rect.height)
            out_page.insert_image(out_page.rect, stream=png.getvalue())
        result = output.tobytes(garbage=4, deflate=True)
        output.close(); source.close()
        return Response(content=result, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="nexsa-ocr-reconstructed.pdf"', "X-PDF-Mode": "ocr-reconstruction"})
    except HTTPException: raise
    except Exception as exc: raise HTTPException(422, "OCR reconstruction failed: " + str(exc)[:180])
