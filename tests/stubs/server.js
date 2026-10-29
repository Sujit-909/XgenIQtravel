export class NextResponse extends Response {
  static next() { return new NextResponse(null); }
  static redirect(url) { return new NextResponse(null, { status: 307, headers: { location: String(url) } }); }
}
