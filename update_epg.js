const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const start = yesterday.toISOString().split('T')[0] + 'T16:00:00Z';
  const end = now.toISOString().split('T')[0] + 'T16:00:00Z';
  
  const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=1&pageSize=100`;
  
  try {
    const res = await fetch(url);
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

      // Explicitly check inside lon and lod arrays for the program titles
      let title = "Regular Programming";
      if (p.lon && Array.isArray(p.lon) && p.lon[0] && p.lon[0].n) {
        title = p.lon[0].n;
      } else if (p.lod && Array.isArray(p.lod) && p.lod[0] && p.lod[0].n) {
        title = p.lod[0].n;
      } else if (p.title) {
        title = p.title;
      } else if (p.name) {
        title = p.name;
      }

      let desc = "";
      if (p.lod && Array.isArray(p.lod) && p.lod[0] && p.lod[0].d) {
        desc = p.lod[0].d;
      } else if (p.lon && Array.isArray(p.lon) && p.lon[0] && p.lon[0].d) {
        desc = p.lon[0].d;
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
