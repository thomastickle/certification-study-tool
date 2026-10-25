/** Model browser Path matching and deletion for the app's explicitly scoped test cookies. */
export class BrowserCookies {
  private values = new Map<string, { pair: string; path: string }>()

  accept(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const [pair, ...attributes] = value.split(';').map((part) => part.trim())
      const path = attributes.find((part) => /^path=/i.test(part))?.slice(5) ?? '/'
      const name = pair!.slice(0, pair!.indexOf('='))
      const key = name + ';' + path
      const maxAge = attributes.find((part) => /^max-age=/i.test(part))?.slice(8)
      if (maxAge !== undefined && Number(maxAge) <= 0) {
        this.values.delete(key)
      } else {
        this.values.set(key, { pair: pair!, path })
      }
    }
  }

  header(pathname: string): string {
    return [...this.values.values()]
      .filter(
        ({ path }) =>
          pathname === path || pathname.startsWith(path.endsWith('/') ? path : path + '/'),
      )
      .sort((left, right) => right.path.length - left.path.length)
      .map(({ pair }) => pair)
      .join('; ')
  }
}
