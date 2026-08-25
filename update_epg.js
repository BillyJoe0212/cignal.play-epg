const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Format dates explicitly in Asia/Manila timezone
  const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  
  const todayStr = formatter.format(now);
  const tomorrowObj = new Date(now.getTime() + (24 * 60 * 60 * 1000));
  const tomorrowStr = formatter.format(tomorrowObj);

  // UTC query bounds covering today and tomorrow
  const start = `${todayStr}T00:00:00Z`;
  const end = `${tomorrowStr}T23:59:59Z`;

  console.log(`Fetching schedule between ${start} and ${end}...`);

  let allChannels = [];
  let page = 1;

  // 1. Loop through all pages to fetch every single channel in Cignal's catalog
  try {
    while (page <= 10) {
      const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=${page}&pageSize=100`;
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.log(`Page ${page} returned HTTP ${res.status}, stopping pagination.`);
        break;
      }

      const json = await res.json();
      const pageData = json.data || [];

      if (!Array.isArray(pageData) || pageData.length === 0) {
        break;
      }

      allChannels = allChannels.concat(pageData);
      page++;
    }

    if (allChannels.length === 0) {
      throw new Error("No channel entries found across API pages.");
    }

    const channelMap = new Map();
    const programList = [];

    const formatXmlTime = (dateStr) => {
      const d = new Date(dateStr);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    };

    // 2. Process all channels
    allChannels.forEach(chItem => {
      const chId = chItem.cs || (chItem.airing && chItem.airing[0] && chItem.airing[0].ch && chItem.airing[0].ch.cs);
      const chName = (chItem.lon && chItem.lon[0] && chItem.lon[0].n) || chId;

      if (!chId) return;

      if (!channelMap.has(chId) || (chName && chName !== chId)) {
        channelMap.set(chId, chName);
      }

      if (Array.isArray(chItem.airing)) {
        chItem.airing.forEach(air => {
          const title = (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || 
                        (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || 
                        "Regular Programming";

          const desc = (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || "";
          
          const startTime = air.sc_st_dt;
          const endTime = air.sc_ed_dt;

          if (startTime && endTime) {
            programList.push({
              chId,
              title,
              desc,
              start: formatXmlTime(startTime),
              stop: formatXmlTime(endTime),
              isPlaceholder: air.sc_chty === 'placeholder' || air.src === 'placeholder' || air.id === 'to-be-announced'
            });
          }
        });
      }
    });

    // 3. Deduplicate: if a channel has real programs, remove duplicate placeholder entries
    const channelHasRealPrograms = new Set();
    programList.forEach(p => {
      if (!p.isPlaceholder) {
        channelHasRealPrograms.add(p.chId);
      }
    });

    const finalPrograms = programList.filter(p => {
      // If the channel has genuine schedule data, discard dummy entries
      if (channelHasRealPrograms.has(p.chId) && p.isPlaceholder) {
        return false;
      }
      return true;
    });

    // 4. Construct XMLTV
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;

    channelMap.forEach((name, id) => {
      xml += `  <channel id="${escapeXml(id)}">\n    <display-name>${escapeXml(name)}</display-name>\n  </channel>\n`;
    });

    finalPrograms.forEach(p => {
      xml += `  <programme start="${p.start}" stop="${p.stop}" channel="${escapeXml(p.chId)}">\n`;
      xml += `    <title lang="en">${escapeXml(p.title)}</title>\n`;
      if (p.desc && p.desc.trim() !== "" && p.desc !== p.title) {
        xml += `    <desc lang="en">${escapeXml(p.desc)}</desc>\n`;
      }
      xml += `  </programme>\n`;
    });

    xml += `</tv>`;

    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Success: Generated cignal.xml with ${channelMap.size} channels and ${finalPrograms.length} programs across ${page - 1} pages.`);
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
