const fs = require('fs');

async function generateEPG() {
  const now = new Date();
  const manilaOffset = 8 * 60 * 60 * 1000;
  const manilaNow = new Date(now.getTime() + manilaOffset);
  
  // Exact range from 12:00 AM Manila Time (today) to 4 days ahead
  const startUtc = new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate(), 0, 0, 0) - manilaOffset);
  const endUtc = new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate() + 4, 23, 59, 59) - manilaOffset);

  const start = startUtc.toISOString().split('.')[0] + 'Z';
  const end = endUtc.toISOString().split('.')[0] + 'Z';

  console.log(`Fetching schedule from ${start} to ${end}...`);

  let allChannels = [];
  let page = 1;

  while (page <= 10) {
    const url = `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${start}&end=${end}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=${page}&pageSize=100`;
    
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        }
      });

      if (!res.ok) break;

      const json = await res.json();
      const pageData = json.data || [];
      if (!Array.isArray(pageData) || pageData.length === 0) break;

      allChannels = allChannels.concat(pageData);
      page++;
    } catch (err) {
      break;
    }
  }

  const channelMap = new Map();
  const programMap = new Map();

  const formatXmlTime = (dateStr) => {
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  };

  allChannels.forEach(chItem => {
    // Collect all valid IDs present on the channel object
    const idSet = new Set();

    if (chItem.cs) idSet.add(chItem.cs);
    if (chItem.ex_id) idSet.add(chItem.ex_id);

    const firstAir = chItem.airing && chItem.airing[0];
    if (firstAir && firstAir.ch) {
      if (firstAir.ch.cs) idSet.add(firstAir.ch.cs);
      if (firstAir.ch.ex_id) idSet.add(firstAir.ch.ex_id);
      if (firstAir.ch.acs) idSet.add(firstAir.ch.acs);
    }

    if (firstAir && Array.isArray(firstAir.ep)) {
      firstAir.ep.forEach(e => {
        if (e && e.id) idSet.add(e.id);
      });
    }

    const chName = (chItem.lon && chItem.lon[0] && chItem.lon[0].n) || Array.from(idSet)[0] || "Unknown Channel";

    // Register all discovered IDs in the channel header list
    idSet.forEach(id => {
      if (id && !channelMap.has(id)) {
        channelMap.set(id, chName);
      }
    });

    if (Array.isArray(chItem.airing)) {
      chItem.airing.forEach(air => {
        let title = (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || 
                    (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || 
                    "To Be Announced";

        let desc = (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) || 
                   (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) || "";

        const startTime = air.sc_st_dt;
        const endTime = air.sc_ed_dt;

        if (startTime && endTime) {
          const isPlaceholder = air.sc_chty === 'placeholder' || air.src === 'placeholder' || air.id === 'to-be-announced' || title.trim() === 'To Be Announced';

          // Emit program entries across all detected ID variants
          idSet.forEach(targetId => {
            const slotKey = `${targetId}_${startTime}`;
            
            if (!programMap.has(slotKey)) {
              programMap.set(slotKey, {
                chId: targetId,
                title,
                desc,
                start: formatXmlTime(startTime),
                stop: formatXmlTime(endTime),
                isPlaceholder
              });
            } else {
              const existing = programMap.get(slotKey);
              if (existing.isPlaceholder && !isPlaceholder) {
                programMap.set(slotKey, {
                  chId: targetId,
                  title,
                  desc,
                  start: formatXmlTime(startTime),
                  stop: formatXmlTime(endTime),
                  isPlaceholder
                });
              }
            }
          });
        }
      });
    }
  });

  const finalPrograms = Array.from(programMap.values());

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
  console.log(`Success: Exported ${channelMap.size} channel IDs and ${finalPrograms.length} scheduled programs.`);
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
