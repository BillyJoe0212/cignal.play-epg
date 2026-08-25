const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  
  // Calculate bounds covering Manila time (today + next 2 days)
  const manilaOffset = 8 * 60 * 60 * 1000;
  const manilaNow = new Date(now.getTime() + manilaOffset);
  
  const startManila = new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate(), 0, 0, 0) - manilaOffset);
  const endManila = new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate() + 2, 23, 59, 59) - manilaOffset);

  const start = startManila.toISOString().split('.')[0] + 'Z';
  const end = endManila.toISOString().split('.')[0] + 'Z';

  console.log(`Fetching schedule from ${start} to ${end}...`);

  const endpoints = [
    `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=web&client=pldt-cignal-web&pageNumber=1&pageSize=100`,
    `https://data-store-cdn.api.pldtcms.quickplay.com/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=1&pageSize=100`
  ];

  let rawChannels = [];

  for (const url of endpoints) {
    try {
      console.log(`Trying endpoint: ${url}`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        }
      });

      if (!res.ok) {
        console.log(`Endpoint returned HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      if (json && Array.isArray(json.data) && json.data.length > 0) {
        rawChannels = json.data;
        console.log(`Successfully fetched ${rawChannels.length} channel blocks.`);
        break;
      }
    } catch (err) {
      console.log(`Endpoint fetch error: ${err.message}`);
    }
  }

  if (rawChannels.length === 0) {
    console.error("Warning: No channel data retrieved from any endpoint.");
    process.exit(1);
  }

  const channelMap = new Map();
  const programList = [];

  const formatXmlTime = (dateStr) => {
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  };

  rawChannels.forEach(chItem => {
    const chId = chItem.cs || (chItem.airing && chItem.airing[0] && chItem.airing[0].ch && chItem.airing[0].ch.cs);
    const chName = (chItem.lon && chItem.lon[0] && chItem.lon[0].n) || chId;

    if (!chId) return;

    if (!channelMap.has(chId) || (chName && chName !== chId)) {
      channelMap.set(chId, chName);
    }

    if (Array.isArray(chItem.airing)) {
      chItem.airing.forEach(air => {
        // Keep both genuine and TBA programs
        let title = (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || 
                    (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || 
                    "To Be Announced";

        let desc = (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || 
                   (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || "";

        const startTime = air.sc_st_dt;
        const endTime = air.sc_ed_dt;

        if (startTime && endTime) {
          programList.push({
            chId,
            title,
            desc,
            start: formatXmlTime(startTime),
            stop: formatXmlTime(endTime),
            isPlaceholder: air.sc_chty === 'placeholder' || air.src === 'placeholder' || air.id === 'to-be-announced' || title === 'To Be Announced'
          });
        }
      });
    }
  });

  // If a channel has both real programs and dummy TBA duplicates for the exact same hour, prefer the real programs
  const channelHasReal = new Set();
  programList.forEach(p => {
    if (!p.isPlaceholder) {
      channelHasReal.add(p.chId);
    }
  });

  const finalPrograms = programList.filter(p => {
    // Drop placeholder duplicate ONLY if this channel has genuine programs
    if (channelHasReal.has(p.chId) && p.isPlaceholder) {
      return false;
    }
    return true;
  });

  // Generate XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;

  // Output channels first
  channelMap.forEach((name, id) => {
    xml += `  <channel id="${escapeXml(id)}">\n    <display-name>${escapeXml(name)}</display-name>\n  </channel>\n`;
  });

  // Output all program slots (including TBA where no schedule is published)
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
  console.log(`Success: Written ${channelMap.size} channels and ${finalPrograms.length} programs (including TBA fallbacks) to cignal.xml.`);
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
