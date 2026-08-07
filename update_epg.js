const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Define query bounds for yesterday, today, and tomorrow in UTC ISO format
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().split('.')[0] + 'Z';
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2)).toISOString().split('.')[0] + 'Z';

  console.log(`Fetching schedule between ${start} and ${end}...`);

  let allAirings = [];
  let page = 1;

  try {
    while (page <= 10) {
      const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=${page}&pageSize=100`;
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) break;

      const data = await res.json();
      
      let pageItems = [];
      function extractAirings(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(item => {
            if (item && typeof item === 'object' && (item.sc_st_dt || item.startTime || item.ch)) {
              pageItems.push(item);
            } else {
              extractAirings(item);
            }
          });
        } else {
          for (let k in obj) {
            if (Array.isArray(obj[k]) && obj[k].length > 0) {
              const first = obj[k][0];
              if (first && typeof first === 'object' && (first.sc_st_dt || first.startTime || first.ch)) {
                pageItems = pageItems.concat(obj[k]);
                continue;
              }
            }
            extractAirings(obj[k]);
          }
        }
      }

      extractAirings(data);

      if (pageItems.length === 0) break;
      allAirings = allAirings.concat(pageItems);
      page++;
    }

    if (allAirings.length === 0) {
      throw new Error("No schedule entries returned from API.");
    }

    const channelMap = new Map();
    const programList = [];

    // Separate Channels and Programs
    allAirings.forEach(item => {
      if (!item || typeof item !== 'object') return;
      
      const chObj = item.ch || item.channel || {};
      const chId = chObj.cs || item.channelId || chObj.id || "unknown_channel";
      const chName = chObj.n || item.channelName || chObj.name || chId;

      if (!channelMap.has(chId) && chId !== "unknown_channel") {
        channelMap.set(chId, chName);
      }

      const pgmObj = item.pgm || item.program || {};
      const lonObj = (pgmObj.lon && pgmObj.lon[0]) || (item.lon && item.lon[0]) || {};
      const lodObj = (pgmObj.lod && pgmObj.lod[0]) || (item.lod && item.lod[0]) || {};

      let title = lonObj.n || lodObj.n || item.title || pgmObj.title || "Regular Programming";
      let desc = lodObj.d || pgmObj.desc || item.description || "";

      const startTime = item.sc_st_dt || item.startTime || item.start;
      const endTime = item.sc_ed_dt || item.endTime || item.end;

      if (startTime && endTime) {
        programList.push({ chId, title, desc, startTime, endTime });
      }
    });

    // Build XMLTV Document (All <channel> entries first, then <programme> entries)
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;

    channelMap.forEach((name, id) => {
      xml += `  <channel id="${escapeXml(id)}">\n    <display-name>${escapeXml(name)}</display-name>\n  </channel>\n`;
    });

    const formatXmlTime = (dateStr) => {
      const d = new Date(dateStr);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    };

    programList.forEach(p => {
      xml += `  <programme start="${formatXmlTime(p.startTime)}" stop="${formatXmlTime(p.endTime)}" channel="${escapeXml(p.chId)}">\n`;
      xml += `    <title lang="en">${escapeXml(p.title)}</title>\n`;
      if (p.desc && p.desc.trim() !== "") {
        xml += `    <desc lang="en">${escapeXml(p.desc)}</desc>\n`;
      }
      xml += `  </programme>\n`;
    });

    xml += `</tv>`;

    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Success: Generated cignal.xml with ${channelMap.size} channels and ${programList.length} programs.`);
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
