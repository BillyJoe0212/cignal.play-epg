const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Define query bounds for today and tomorrow in UTC
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
      
      let items = [];
      if (data && data.data && Array.isArray(data.data)) {
        items = data.data;
      } else if (Array.isArray(data)) {
        items = data;
      }

      if (items.length === 0) break;

      allAirings = allAirings.concat(items);
      page++;
    }

    if (allAirings.length === 0) {
      throw new Error("No schedule data returned from Cignal API.");
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;
    const uniqueChannels = new Set();
    let channelXml = "";
    let programXml = "";

    allAirings.forEach(item => {
      if (!item) return;
      
      const chObj = item.ch || item.channel || {};
      const chId = chObj.cs || item.channelId || chObj.id || "unknown_channel";
      const chName = chObj.n || item.channelName || chObj.name || chId;

      if (!uniqueChannels.has(chId)) {
        uniqueChannels.add(chId);
        channelXml += `  <channel id="${chId}">\n    <display-name>${escapeXml(chName)}</display-name>\n  </channel>\n`;
      }

      const pgmObj = item.pgm || item.program || {};
      const lonObj = (pgmObj.lon && pgmObj.lon[0]) || (item.lon && item.lon[0]) || {};
      const lodObj = (pgmObj.lod && pgmObj.lod[0]) || (item.lod && item.lod[0]) || {};

      let title = lonObj.n || lodObj.n || item.title || pgmObj.title || "Regular Programming";
      let desc = lodObj.d || pgmObj.desc || item.description || "";

      const startTime = item.sc_st_dt || item.startTime || item.start;
      const endTime = item.sc_ed_dt || item.endTime || item.end;

      if (startTime && endTime) {
        // Format UTC dates directly into standard XMLTV timestamps (YYYYMMDDHHMMSS +0000)
        const sDate = new Date(startTime);
        const eDate = new Date(endTime);

        const formatXmlTime = (d) => {
          const pad = (n) => String(n).padStart(2, '0');
          return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
        };

        programXml += `  <programme start="${formatXmlTime(sDate)}" stop="${formatXmlTime(eDate)}" channel="${chId}">\n`;
        programXml += `    <title lang="en">${escapeXml(title)}</title>\n`;
        if (desc && desc.trim() !== "") {
          programXml += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
        }
        programXml += `  </programme>\n`;
      }
    });

    xml += channelXml + programXml + `</tv>`;
    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Successfully generated cignal.xml with ${allAirings.length} programs.`);
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
