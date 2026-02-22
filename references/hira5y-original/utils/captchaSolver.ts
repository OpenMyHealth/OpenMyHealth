import { PSM, Worker } from "tesseract.js";

export default async function captchaSolver(
  base64CaptchaImage: Buffer,
  worker: Worker,
) {
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: PSM.SINGLE_WORD,
    preserve_interword_spaces: "0",
  });

  const ret = await worker.recognize(base64CaptchaImage);
  return ret.data.text;
}
