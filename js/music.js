// Set available to true only after the user's MP3 has been placed at this path.
// No substitute music is bundled or fetched from external services.
export const BGM_TRACK = Object.freeze({
  src: new URL("../audio/bgm.mp3", import.meta.url).href,
  available: false,
});
