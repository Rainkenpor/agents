import https from "node:https";

export function encodeSegment(input: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(input));
  } catch {
    return encodeURIComponent(input);
  }
}

export function httpsRequest<T>(options: https.RequestOptions, body?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
          return;
        }

        let message = `HTTP ${res.statusCode}`;
        try {
          const parsed = JSON.parse(data) as { message?: string };
          if (parsed.message) message = `HTTP ${res.statusCode}: ${parsed.message}`;
        } catch {}

        reject(new Error(message));
      });
    });

    req.on("error", (error) => reject(new Error(`Red: ${error.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

export function httpsGetOrNull<T>(options: https.RequestOptions): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }

        if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
          return;
        }

        let message = `HTTP ${res.statusCode}`;
        try {
          const parsed = JSON.parse(data) as { message?: string };
          if (parsed.message) message = `HTTP ${res.statusCode}: ${parsed.message}`;
        } catch {}

        reject(new Error(message));
      });
    });

    req.on("error", (error) => reject(new Error(`Red: ${error.message}`)));
    req.end();
  });
}
