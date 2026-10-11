// The supplied 月下花园.mp3 is bundled unchanged at this path.
// No substitute music is bundled or fetched from external services.
export const BGM_TRACK = Object.freeze({
  src: new URL("../audio/bgm.mp3", import.meta.url).href,
  available: true,
});
