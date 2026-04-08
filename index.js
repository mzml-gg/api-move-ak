import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;

// قائمة User-Agents مختلفة للتبديل بينها
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ---------- إنشاء جلسة Axios مع headers ----------
function createSession() {
  return axios.create({
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept-Language': 'ar,en;q=0.9,en-US;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'Referer': 'https://ak.sv/',
    },
    timeout: 30000,
    decompress: true,
  });
}

// ---------- 1. البحث عن الأفلام ----------
async function searchMovies(query, maxPages = 3) {
  const encodedQuery = encodeURIComponent(query);
  const baseUrl = `https://ak.sv/search?q=${encodedQuery}`;
  let allResults = [];
  let page = 1;

  while (page <= maxPages) {
    const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`;
    try {
      const session = createSession();
      const { data } = await session.get(url);
      const $ = cheerio.load(data);
      const movieEntries = $('div.entry-box');

      if (movieEntries.length === 0) break;

      const pageResults = [];
      movieEntries.each((i, el) => {
        const imgTag = $(el).find('img');
        let imgUrl = imgTag.attr('data-src') || imgTag.attr('src') || '';
        if (imgUrl.includes('placeholder')) imgUrl = imgTag.attr('data-src') || '';
        if (imgUrl && !imgUrl.startsWith('http')) {
          imgUrl = imgUrl.startsWith('//') ? 'https:' + imgUrl : imgUrl;
        }

        const genreSpans = $(el).find('span.badge-light');
        const genres = genreSpans.map((i, span) => $(span).text().trim()).get().join(', ') || 'غير محدد';

        const linkTag = $(el).find('a[href*="/movie/"]');
        let movieUrl = linkTag.attr('href');
        if (movieUrl && !movieUrl.startsWith('http')) {
          movieUrl = 'https://ak.sv' + movieUrl;
        }

        const titleTag = $(el).find('h3 a');
        const title = titleTag.text().trim() || 'بدون عنوان';

        if (title && movieUrl) {
          pageResults.push({ title, image: imgUrl, genres, url: movieUrl });
        }
      });

      if (pageResults.length === 0) break;
      allResults.push(...pageResults);
      page++;

      const nextBtn = $('a:contains("التالي"), a:contains("next"), a:contains("»")').last();
      if (nextBtn.length === 0 || !nextBtn.attr('href')) break;
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      break;
    }
  }
  
  return allResults;
}

// ---------- 2. جلب جميع تفاصيل الفيلم ----------
async function getMovieDetails(movieUrl) {
  const session = createSession();
  const { data } = await session.get(movieUrl);
  const $ = cheerio.load(data);

  const title = $('h1.entry-title').text().trim() || 'غير معروف';

  let story = 'لا توجد قصة متاحة';
  const storyDiv = $('div.widget-body');
  if (storyDiv.length) {
    const storyH2 = storyDiv.find('h2');
    if (storyH2.length) {
      let storyText = storyH2.text().trim();
      storyText = storyText.replace(/فيلم\s+.+?undefined/, '').trim();
      story = storyText || story;
    }
  }

  const info = {};
  $('div.font-size-16.text-white.mt-2').each((i, el) => {
    const text = $(el).text().trim();
    const colonIndex = text.indexOf(':');
    if (colonIndex !== -1) {
      const key = text.substring(0, colonIndex).trim();
      let value = text.substring(colonIndex + 1).trim();
      if (key === 'اللغة') info.language = value;
      else if (key === 'الترجمة') info.subtitle = value;
      else if (key === 'جودة الفيلم') info.quality = value;
      else if (key === 'انتاج') info.production = value;
      else if (key === 'السنة') info.year = value;
      else if (key === 'مدة الفيلم') info.duration = value;
    }
  });

  const language = info.language || 'غير محدد';
  const subtitle = info.subtitle || 'غير محدد';
  const quality = info.quality || 'غير محدد';
  const production = info.production || 'غير محدد';
  const year = info.year || 'غير محدد';
  const duration = info.duration || 'غير محدد';

  let addedDate = 'غير محدد';
  let lastUpdate = 'غير محدد';
  const addedElem = $('div.font-size-14.text-muted.mt-3 span');
  if (addedElem.length) {
    const addedText = addedElem.text().trim();
    if (addedText.includes('تـ الإضافة')) {
      addedDate = addedText.split(':')[1]?.trim() || addedText;
    }
  }
  const updateElem = $('div.font-size-14.text-muted span');
  if (updateElem.length) {
    const updateText = updateElem.text().trim();
    if (updateText.includes('تـ اخر تحديث')) {
      lastUpdate = updateText.split(':')[1]?.trim() || updateText;
    }
  }

  let genres = 'غير محدد';
  const genreLinks = $('div.d-flex.align-items-center.mt-3 a.badge-light');
  if (genreLinks.length) {
    genres = genreLinks.map((i, el) => $(el).text().trim()).get().join(', ');
  }

  const cast = [];
  $('div.entry-box-3').each((i, el) => {
    const img = $(el).find('img');
    let imgUrl = img.attr('src') || '';
    if (imgUrl && !imgUrl.startsWith('http')) imgUrl = 'https:' + imgUrl;
    const name = $(el).find('div.entry-title').text().trim();
    if (name) cast.push({ name, image: imgUrl });
  });

  const downloads = [];
  const tabs = $('div.tab-content.quality');
  tabs.each((i, tab) => {
    const tabId = $(tab).attr('id');
    const qualityBtn = $(`a[href="#${tabId}"]`);
    let qualityText = qualityBtn.text().trim();
    if (!qualityText) qualityText = tabId.replace('tab-', '') + 'p';

    let watchUrl = null, downloadUrl = null, size = null;
    const rows = $(tab).find('div.row');
    rows.each((j, row) => {
      const watchLink = $(row).find('a.link-show');
      if (watchLink.length) watchUrl = watchLink.attr('href');
      const downloadLink = $(row).find('a.link-download');
      if (downloadLink.length) {
        downloadUrl = downloadLink.attr('href');
        const sizeSpan = downloadLink.find('span.font-size-14');
        if (sizeSpan.length) size = sizeSpan.text().trim();
      }
      if (downloadUrl) return false;
    });
    if (downloadUrl) downloads.push({ quality: qualityText, watchUrl, downloadUrl, size: size || 'غير محدد' });
  });

  return {
    title, story, language, subtitle, quality, production, year, duration,
    addedDate, lastUpdate, genres, cast, downloads,
  };
}

// ---------- 3. استخراج الرابط المباشر عبر وكيل ----------
async function extractDirectLink(intermediateUrl) {
  try {
    // استخدام وكيل مجاني لتجنب حظر Vercel
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(intermediateUrl)}`;
    
    const resp = await axios.get(proxyUrl, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 30000
    });
    
    const html = resp.data;
    let internalUrl = null;
    
    let match = html.match(/href=["'](https?:\/\/ak\.sv\/download\/\d+\/\d+\/[^"']+)["']/i);
    if (match) internalUrl = match[1];
    else {
      const $ = cheerio.load(html);
      const downloadLinkElem = $('a.download-link');
      if (downloadLinkElem.length) internalUrl = downloadLinkElem.attr('href');
    }
    
    if (!internalUrl) throw new Error('لم يتم العثور على رابط التحميل الداخلي');
    if (internalUrl.startsWith('//')) internalUrl = 'https:' + internalUrl;
    if (!internalUrl.startsWith('http')) internalUrl = 'https://ak.sv' + internalUrl;
    
    // جلب صفحة التحميل النهائية عبر الوكيل أيضاً
    const resp2 = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(internalUrl)}`, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 30000
    });
    
    const html2 = resp2.data;
    
    let directUrl = null;
    const regex = /href=["'](https?:\/\/[^"']+downet\.net\/download\/[^"']+\.mp4[^"']*)["']/i;
    const match2 = html2.match(regex);
    if (match2) directUrl = match2[1];
    
    if (!directUrl) {
      const regex2 = /https?:\/\/s\d+d\d+\.downet\.net\/download\/[^\s"']+\.mp4/i;
      const match3 = html2.match(regex2);
      if (match3) directUrl = match3[0];
    }
    
    if (!directUrl) throw new Error('لم يتم العثور على رابط التحميل المباشر');
    if (directUrl.startsWith('//')) directUrl = 'https:' + directUrl;
    
    return directUrl;
    
  } catch (err) {
    throw new Error(`فشل استخراج الرابط المباشر: ${err.message}`);
  }
}

// ---------- 4. جلب التفاصيل مع الروابط المباشرة ----------
async function getMovieDetailsWithDirectLinks(movieUrl) {
  const details = await getMovieDetails(movieUrl);
  const downloadsObj = {};
  
  for (const dl of details.downloads) {
    try {
      const directLink = await extractDirectLink(dl.downloadUrl);
      downloadsObj[dl.quality] = {
        size: dl.size,
        watchUrl: dl.watchUrl,
        intermediateUrl: dl.downloadUrl,
        directUrl: directLink,
      };
      // تأخير بين الطلبات
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      downloadsObj[dl.quality] = {
        size: dl.size,
        watchUrl: dl.watchUrl,
        intermediateUrl: dl.downloadUrl,
        directUrl: null,
        error: err.message,
      };
    }
  }
  
  details.downloads = downloadsObj;
  return details;
}

// ---------- 5. API Routes ----------
app.get('/', async (req, res) => {
  const { search, url } = req.query;
  
  if (search && search.trim() !== '') {
    try {
      const results = await searchMovies(search, 3);
      return res.json({ success: true, data: results });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  } 
  else if (url && url.trim() !== '') {
    try {
      const details = await getMovieDetailsWithDirectLinks(url);
      const orderedDetails = {
        title: details.title,
        story: details.story,
        language: details.language,
        subtitle: details.subtitle,
        quality: details.quality,
        production: details.production,
        year: details.year,
        duration: details.duration,
        addedDate: details.addedDate,
        lastUpdate: details.lastUpdate,
        genres: details.genres,
        cast: details.cast,
        downloads: details.downloads,
      };
      return res.json({ success: true, data: orderedDetails });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  
  res.json({
    success: true,
    message: 'مرحباً بك في API بحث و تحميل افلام من منصه اكاوم by monte',
    endpoints: {
      search: '/?search=اسم_الفيلم',
      movieDetails: '/?url=رابط_الفيلم'
    },
    example: {
      search: 'https://monte-apis-dev-search-ak.vercel.app/?search=spider-man',
      movieDetails: 'https://monte-apis-dev-search-ak.vercel.app/?url=https://ak.sv/movie/8601/spider-man-across-the-spider-verse'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API يعمل على المنفذ ${PORT}`);
});
