const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  // Set start time to yesterday evening to cover current live broadcasts
  const startObj = new Date(now.getTime() - (12 * 60 * 60 * 1000));
  // Set end time to 36 hours into the future so OTT Navigator always has ahead-data
  const endObj = new Date(now.getTime() + (36 * 60 * 60 * 1000));

  const start = startObj.toISOString().split('T')[0] + 'T00:00:00Z';
  const end = endObj.toISOString().split('T')[0] + 'T23:59:59Z';
  
  const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=1&pageSize=100`;
  
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
          if (item && typeof item === 'object' && (item.sc_st_dt || item.startTime || item.ch)) {
            rawPrograms.push(item);
          } else {
            findAirings(item);
          }
        });
      } else {
        for (let key in obj) {
          if (Array.isArray(obj[key]) && obj[key].length > 0) {
            const first = obj[key][0];
            if (first && typeof first === 'object' && (first.sc_st_dt || first.startTime || first.ch)) {
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
