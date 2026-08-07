const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Date range for yesterday, today, and tomorrow in UTC ISO format
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
      throw new Error("No schedule data returned from API.");
    }

    const channelMap = new Map();
    const programList = [];

    // First Pass: Separate Channels and Programs cleanly
    allAirings.forEach(item => {
      if (!item) return;
      
      const chObj = item.ch || item.channel || {};
      const chId = chObj.cs || item.channelId || chObj.id || "unknown_channel";
      const chName = chObj.n || item.channelName || chObj.name || chId;

      if (!channelMap.has(chId)) {
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

    // Build Valid XMLTV Document (Channels ALWAYS come before Programmes)
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;

    // 1. Output ALL Channels
    channelMap.forEach((name, id) => {
      xml += `  <channel id="${escapeXml(id)}">\n    <display-name>${escapeXml(name)}</display-name>\n  </channel>\n`;
    });

    // Helper for XMLTV timestamp formatting
    const formatXmlTime = (dateStr) => {
      const d = new Date(dateStr);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
    };

    // 2. Output ALL Programmes
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
    console.log(`Success: Written ${channelMap.size} channels and ${programList.length} programs to cignal.xml.`);
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
