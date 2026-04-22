/**
 * Imgur Upload - Anonymous image hosting
 * 
 * Uses Imgur's anonymous upload (no API key required for basic uploads).
 * Images are hosted permanently with direct URLs.
 */

export async function uploadToImgur(base64Data) {
  const clientId = process.env.IMGUR_CLIENT_ID || "546c25a59c58ad7";
  
  const response = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: {
      Authorization: `Client-ID ${clientId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: base64Data,
      type: "base64",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Imgur upload failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`Imgur upload failed: ${JSON.stringify(data)}`);
  }

  return {
    url: data.data.link,
    deleteHash: data.data.deletehash,
  };
}
