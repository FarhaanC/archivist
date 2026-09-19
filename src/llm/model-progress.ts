/**
 * Plain sentences for the model download.
 *
 * WebLLM reports its own progress in its own words: "Start to fetch params",
 * "Fetching param cache[15/58]: 409MB fetched. 23% completed, 12 secs
 * elapsed.". Those were passed straight to the screen. Nobody outside this
 * project knows what a param cache is, and the person this app is for should
 * never have to.
 *
 * Two things are worth saying: whether the model is being downloaded or just
 * loaded from what was downloaded before, and how far along it is. Everything
 * else in those strings is detail the user cannot act on.
 */

/** WebLLM says "Fetching ..." while downloading and "Loading ..." while
 *  reading what is already stored. */
const DOWNLOADING = /^fetching\b/i;
const FROM_STORE = /^loading\b/i;

const percentIn = (text: string): string | null =>
    /(\d{1,3})\s*%/.exec(text)?.[1] ?? null;

export const describeModelProgress = (rawText: string): string => {
    const text = rawText.trim();
    const percent = percentIn(text);

    if (percent === null) return 'Getting the model ready…';
    // Said once, because it is the download that takes the time and people
    // reasonably worry it will happen on every question.
    if (DOWNLOADING.test(text)) {
        return `Downloading the model — ${percent}% done (this happens once)`;
    }
    if (FROM_STORE.test(text)) return `Getting the model ready — ${percent}%`;
    return `Getting the model ready — ${percent}%`;
};
