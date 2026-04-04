/**
 * Common English stop words. Chunks composed mostly of these are shown
 * slightly faster since they carry low semantic weight.
 */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'may', 'might', 'must', 'can', 'could',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
  'than', 'too', 'very', 's', 't', 'just', 'don', 'should', 'now',
  'in', 'of', 'to', 'up', 'out', 'on', 'at', 'as', 'by', 'into',
  'with', 'about', 'against', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'from', 'down', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there',
  'any', 'if', 'then', 'because', 'while', 'although', 'though',
  'even', 'also', 'back', 'get', 'go', 'make', 'like', 'know',
  'see', 'look', 'come', 'say', 'said', 'well', 'way', 'new', 'old',
  'got', 'let', 'put', 'take', 'used', 'still', 'being', 'much',
  'own', 'never', 'always', 'every', 'already', 'upon', 'us',
]);
