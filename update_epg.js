const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  const startStr = now.toISOString().split('T')[0];
  
  const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/schedules?date=${startStr}&reg=ph&client=pldt-cignal-web`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const data = await res.json();
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;
    const uniqueChannels = new Set();
    let channelXml = "";
    let programXml = "";

    let rawPrograms = [];
    function findAirings(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(item => {
          if (item && typeof item === 'object' && (item.sc_st_dt || item.startTime || item.ch || item.title || item.name)) {
            rawPrograms.push(item);
          } else {
            findAirings(item);
          }
        });
      } else {
        for (let key in obj) {
          if (Array.isArray(obj[key]) && obj[key].length > 0) {
            const first = obj[key][0];
            if (first && typeof first === 'object' && (first.sc_st_dt || first.startTime || first.ch || first.title || first.name)) {
              rawPrograms = rawPrograms.concat(obj[key]);
              continue;
            }
          }
          findAirings(obj[key]);
        }
      }
    }
    
    findAirings(data);

    rawPrograms.forEach(p => {
      if (!p || typeof p !== 'object') return;
      
      const chObj = p.ch || {};
      const chId = chObj.cs || p.channelId || "unknown_channel";
      const chName = chObj.n || p.channelName || chId;
      
      if (!uniqueChannels.has(chId)) {
        uniqueChannels.add(chId);
        channelXml += `  <channel id="${chId}">\n    <display-name>${escapeXml(chName)}</display-name>\n  </channel>\n`;
      }

      // Deep title text retrieval fallback map
      const lonObj = (p.lon && p.lon[0]) || {};
      const lodObj = (p.lod && p.lod[0]) || {};
      const pgmObj = p.program || p.pgm || {};
      const pgmExLon = (pgmObj.lon && pgmObj.lon[0]) || {};
      const pgmExLod = (pgmObj.lod && pgmObj.lod[0]) || {};

      let title = lonObj.n || lodObj.n || pgmExLon.n || pgmExLod.n || p.title || pgmObj.title || p.name || pgmObj.name || "Live Program";
      let desc = lodObj.d || lonObj.d || pgmExLod.d || pgmExLon.d || p.description || pgmObj.description || "";

      const startTime = p.sc_st_dt || p.startTime || p.start;
      const endTime = p.sc_ed_dt || p.endTime || p.end;

      if (startTime && endTime) {
        const startClean = startTime.replace(/[-:TZ]/g, '').substring(0, 14) + " +0000";
        const endClean = endTime.replace(/[-:TZ]/g, '').substring(0, 14) + " +0000";
        
        programXml += `  <programme start="${startClean}" stop="${endClean}" channel="${chId}">\n`;
        programXml += `    <title lang="en">${escapeXml(title)}</title>\n`;
        if (desc) programXml += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
        programXml += `  </programme>\n`;
      }
    });

    xml += channelXml + programXml + `</tv>`;
    fs.writeFileSync('cignal.xml', xml, 'utf-8');
    console.log(`Successfully generated cignal.xml for ${uniqueChannels.size} channels.`);
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
