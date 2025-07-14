export function addAppUtm(url: string): string {
  try {
    const parsedUrl = new URL(url);

    parsedUrl.searchParams.set("utm_source", "llame.chat");

    return parsedUrl.toString();
  } catch (error) {
    return url; // Return original URL if parsing fails
  }
}
