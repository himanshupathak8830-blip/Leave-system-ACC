const url = "https://script.google.com/macros/s/AKfycbwtLduBLO2jwZ1BQSctdPaphuigX3y2rCm71ZDS0FBOl-iZ5umL9ALAyu9SkZMiDxtv0A/exec";

async function test() {
  console.log("Testing GET health...");
  try {
    const res = await fetch(url + "?action=health");
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response starts with:", text.substring(0, 200));
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
