/** Immutable routing snapshot; consumers own any query parser or rewritten pathname. */
export type RequestUrl = Readonly<{ pathname: string; search: string }>

/** Copy normalized strings so no consumer can mutate the validated URL seen by another. */
export function requestUrl(url: URL): RequestUrl {
  return Object.freeze({ pathname: url.pathname, search: url.search })
}
