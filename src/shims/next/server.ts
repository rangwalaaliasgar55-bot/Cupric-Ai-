export class NextResponse {
  static json(body: any, init?: ResponseInit) {
    return new Response(JSON.stringify(body), {
      status: init?.status || 200,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  }

  static redirect(url: string, status = 307) {
    return new Response(null, {
      status,
      headers: { Location: url },
    })
  }
}

export type NextRequest = Request
