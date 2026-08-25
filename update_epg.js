const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Format Today and Tomorrow in Manila local time bounds
  const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  
  const todayStr = formatter.format(now);
  const tomorrowObj = new Date(now.getTime() + (24 * 60 * 60 * 1000));
  const tomorrowStr = formatter.format(tomorrowObj);

  const start = `${todayStr}T00:00:00Z`;
  const end = `${tomorrowStr}T23:59:59Z`;

  console.log(`Fetching schedule between ${start} and ${end}...`);

  const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=1&pageSize=100`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`API returned HTTP ${res.status}`);
    }

    const json = await res.json();
    const channels = json.data || [];

    if (!Array.isArray(channels) || channels.length === 0) {
      throw new Error("No channel entries found in API response.");
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;
    let channelXml = "";
    let programXml = "";
    let totalPrograms = 0;

    const formatXmlTime = (dateStr) => {
      const d = new Date(dateStr);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    };

    // 1. Process Channel definitions
    channels.forEach(chItem => {
      const chId = chItem.cs || (chItem.airing && chItem.airing[0] && chItem.airing[0].ch && chItem.airing[0].ch.cs);
      const chName = (chItem.lon && chItem.lon[0] && chItem.lon[0].n) || chId;

      if (!chId) return;

      channelXml += `  <channel id="${escapeXml(chId)}">\n    <display-name>${escapeXml(chName)}</display-name>\n  </channel>\n`;

      // 2. Process Airings for this Channel
      if (Array.isArray(chItem.airing)) {
        chItem.airing.forEach(air => {
          const title = (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || "Regular Programming";
          const desc = (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || "";
          
          const startTime = air.sc_st_dt;
          const endTime = air.sc_ed_dt;

          if (startTime && endTime) {
            programXml += `  <programme start="${formatXmlTime(startTime)}" stop="${formatXmlTime(endTime)}" channel="${escapeXml(chId)}">\n`;
            programXml += `    <title lang="en">${escapeXml(title)}</title>\n`;
            if (desc && desc.trim() !== "") {
              programXml += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
            }
            programXml += `  </programme>\n`;
            totalPrograms++;
          }
        });
      }
    });

    xml += channelXml + programXml + `</tv>`;

    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Success: Generated cignal.xml for ${channels.length} channels and ${totalPrograms} programs.`);
  } catch (err) {
    console.error("Error generating EPG:", err.message);
    process.exit(1);
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString().replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

generateEPG();
