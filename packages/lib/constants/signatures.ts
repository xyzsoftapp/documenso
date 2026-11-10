export const SIGNATURE_CANVAS_DPI = 2;
export const SIGNATURE_MIN_COVERAGE_THRESHOLD = 0.01;

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

// Base64 of the 8-byte PNG magic number.
const PNG_BASE64_MAGIC = 'iVBORw0KGgo';

export const isBase64Image = (value: string) => value.startsWith(PNG_DATA_URL_PREFIX);

// Stricter than `isBase64Image`: also checks the payload is a real PNG.
export const isPngSignatureDataUrl = (value: string) => {
  if (!isBase64Image(value)) {
    return false;
  }

  const payload = value.slice(PNG_DATA_URL_PREFIX.length);

  return payload.startsWith(PNG_BASE64_MAGIC) && /^[A-Za-z0-9+/]+=*$/.test(payload);
};

/**
 * The longest PNG data URL an image field accepts (about 1.5 MB of image). The signing dialog scales an uploaded
 * image down to fit within `IMAGE_FIELD_MAX_DIMENSION` pixels, which keeps a stamp or logo well under this.
 */
export const IMAGE_FIELD_MAX_DATA_URL_LENGTH = 2 * 1024 * 1024;

/** The longest side, in pixels, the signing dialog scales an uploaded image down to */
export const IMAGE_FIELD_MAX_DIMENSION = 800;

/** Whether a value can be inserted into an image field: a PNG data URL that is not too large */
export const isValidImageFieldValue = (value: string) =>
  value.length <= IMAGE_FIELD_MAX_DATA_URL_LENGTH && isPngSignatureDataUrl(value);
