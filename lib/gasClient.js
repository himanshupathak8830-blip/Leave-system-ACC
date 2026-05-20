const https = require("https");

const GAS_URL =
  process.env.GOOGLE_SCRIPT_URL;

async function gasRequest(data) {

  console.log(
    "[GAS] Requesting:",
    data.action
  );

  const response = await fetch(
    GAS_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify(data),

      agent: new https.Agent({
        keepAlive: false
      })
    }
  );

  const text =
    await response.text();

  try {

    return JSON.parse(text);

  } catch (err) {

    throw new Error(
      "Invalid GAS response: " +
      text
    );

  }

}

module.exports = {
  gasRequest
};
