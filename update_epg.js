const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Calculate today and tomorrow bounds in local/UTC format
  const startStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('.')[0] + 'Z';
  const endStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString().split('.')[0] + 'Z';

  console.log(`Requesting EPG between ${startStr} and ${endStr}`);

  let rawPrograms = [];
  let page = 1;

  try {
    while (page <= 10) {
      const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${startStr}&end=${endStr}&reg=ph&client=pldt-cignal-web&pageNumber=${page}&pageSize=100`;
      
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.log(`Page ${page} returned HTTP status ${res.status}`);
        break;
      }

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
      rawPrograms = rawPrograms.concat(pageItems);
      page++;
    }

    if (rawPrograms.length === 0) {
      throw new Error("API returned no program data.");
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;
    const uniqueChannels = new Set();
    let channelXml = "";
    let programXml = "";

    rawPrograms.forEach(p => {
      if (!p || typeof p !== 'object') return;
      const chObj = p.ch || {};
      const chId = chObj.cs || p.channelId || "unknown_channel";
      const chName = chObj.n || p.channelName || chId;
      
      if (!uniqueChannels.has(chId)) {
        uniqueChannels.add(chId);
        channelXml += `  <channel id="${chId}">\n    <display-name>${escapeXml(chName)}</display-name>\n  </channel>\n`;
      }

      const pgmObj = p.pgm || {};
      const lonObj = (pgmObj.lon && pgmObj.lon[0]) || (p.lon && p.lon[0]) || {};
      const lodObj = (pgmObj.lod && pgmObj.lod[0]) || (p.lod && p.lod[0]) || {};
      
      let title = lonObj.n || lodObj.n || p.title || pgmObj.title || "Regular Programming";

      let desc = "";
      if (lonObj.n && lodObj.n && lonObj.n !== lodObj.n) {
        desc = lodObj.n;
      } else if (lodObj.d) {
        desc = lodObj.d;
      } else if (p.description) {
        desc = p.description;
      }

      const startTime = p.sc_st_dt || p.startTime || p.start;
      const endTime = p.sc_ed_dt || p.endTime || p.end;

      if (startTime && endTime) {
        const startClean = startTime.replace(/[-:TZ]/g, '').substring(0, 14) + " +0000";
        const endClean = endTime.replace(/[-:TZ]/g, '').substring(0, 14) + " +0000";
        
        programXml += `  <programme start="${startClean}" stop="${endClean}" channel="${chId}">\n`;
        programXml += `    <title lang="en">${escapeXml(title)}</title>\n`;
        if (desc && desc.trim() !== "") {
          programXml += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
        }
        programXml += `  </programme>\n`;
      }
    });

    xml += channelXml + programXml + `</tv>`;
    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Success! ${uniqueChannels.size} channels and ${rawPrograms.length} programs generated.`);
  } catch (err) {
    console.error("Error generating EPG:", err.message);
    process.exit(1);
  }
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
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
