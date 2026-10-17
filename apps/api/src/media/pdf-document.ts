import { getDocumentProxy } from 'unpdf';

/** Called only by the bounded parse child in production. */
export async function inspectPdfDocument(bytes: Uint8Array) {
  // pdf.js warnings use stdout, which the child reserves for its JSON report.
  const document = await getDocumentProxy(new Uint8Array(bytes), {
    verbosity: 0,
  });
  // getMetadata() inflates the whole XMP stream; permissions detect encryption.
  const permissions = await document.getPermissions();
  return { pages: document.numPages, encrypted: permissions !== null };
}
