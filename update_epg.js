const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Format YYYY-MM-DD for today and tomorrow in Manila time
  const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  
  const today = formatter.format(now);
  const tomorrowObj = new Date(now.getTime() + (24 * 60 * 60 * 1000));
  const tomorrow = formatter.format(tomorrowObj);

  const start = `${today}T00:00:00Z`;
  const end = `${tomorrow}T23:59:59Z`;

  console.log(`Fetching schedule from ${start} to ${end}...`);

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

      if (!res.ok) {
        console.error(`Page ${page} failed with status: ${res.status}`);
        break;
      }

      const data = await res.json();
      
      // Target the data array directly from Cignal's FirstLight schema
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
      throw new Error("No entries returned from API.");
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;
    const uniqueChannels = new Set();
    let channelXml = "";
    let programXml = "";

    allAirings.forEach(item => {
      if (!item) return;
      
      // Extract channel details
      const chObj = item.ch || item.channel || {};
      const chId = chObj.cs || item.channelId || chObj.id || "unknown_channel";
      const chName = chObj.n || item.channelName || chObj.name || chId;

      if (!uniqueChannels.has(chId)) {
        uniqueChannels.add(chId);
        channelXml += `  <channel id="${chId}">\n    <display-name>${escapeXml(chName)}</display-name>\n  </channel>\n`;
      }

      // Extract title and description
      const pgmObj = item.pgm || item.program || {};
      const lonObj = (pgmObj.lon && pgmObj.lon[0]) || (item.lon && item.lon[0]) || {};
      const lodObj = (pgmObj.lod && pgmObj.lod[0]) || (item.lod && item.lod[0]) || {};

      let title = lonObj.n || lodObj.n || item.title || pgmObj.title || "Regular Programming";
      let desc = lodObj.d || pgmObj.desc || item.description || "";

      const startTime = item.sc_st_dt || item.startTime || item.start;
      const endTime = item.sc_ed_dt || item.endTime || item.end;

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
    console.log(`Success: Generated cignal.xml with ${allAirings.length} programs across ${uniqueChannels.size} channels.`);
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
