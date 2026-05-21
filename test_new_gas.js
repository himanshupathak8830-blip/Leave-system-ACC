const url = "https://script.google.com/macros/s/AKfycbzmOLvKdOhGJRkcAe_OAI-QWE5w40iZXW_E8oOEtzqXbq7TDD-W1dVFi0Yq3P2b7Q6XaQ/exec";

async function test() {
  console.log("Testing NEW GET health...");
  try {
    const res = await fetch(url + "?action=health");
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
