const https = require("https");
const GAS_URL = process.env.GOOGLE_SCRIPT_URL;

function gasRequest(data) {
  return new Promise((resolve, reject) => {
    if (!GAS_URL) {
      return reject(new Error("GOOGLE_SCRIPT_URL is not configured in .env"));
    }

    console.log(`[GAS] Requesting action: ${data.action}`);

    const payload = JSON.stringify(data);
    const urlObj = new URL(GAS_URL);

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(urlObj, options, (res) => {
      // Google Apps Script hamesha POST ke baad 302 Redirect bhejta hai
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (redirectRes) => {
          let body = "";
          redirectRes.on("data", chunk => body += chunk);
          redirectRes.on("end", () => processGasResponse(body, resolve, reject));
        }).on("error", reject);
      } else {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => processGasResponse(body, resolve, reject));
      }
    });

    req.on("error", (err) => {
      console.error("[GAS] Network error:", err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

function processGasResponse(body, resolve, reject) {
  try {
    const parsed = JSON.parse(body);
    if (parsed.ok === false || parsed.success === false) {
      console.error("[GAS] Script returned error:", parsed.error || "Unknown error");
      reject(new Error(parsed.error || "GAS request failed"));
    } else {
      resolve(parsed);
    }
  } catch (err) {
    console.error(`[GAS] Non-JSON response received. First 200 chars: ${body.substring(0, 200)}`);
    reject(new Error("Google Apps Script returned an invalid response. Check 'Who has access: Anyone'."));
  }
}

module.exports = {
  gasRequest
};
