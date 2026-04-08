import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- إنشاء جلسة Axios مع headers ----------
function createSession() {
  return axios.create({
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://ak.sv/',
    },
    timeout: 15000,
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
    } catch (err) {
      break;
    }
  }
  return allResults;
}

// ---------- 2. جلب جميع تفاصيل الفيلم (بدون تحويل الروابط) ----------
async function getMovieDetails(movieUrl) {
  const session = createSession();
  const { data } = await session.get(movieUrl);
  const $ = cheerio.load(data);

  const title = $('h1.entry-title').text().trim() || 'غير معروف';

  // القصة
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

  // المعلومات الأساسية
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

  // التواريخ
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

  // الأنواع
  let genres = 'غير محدد';
  const genreLinks = $('div.d-flex.align-items-center.mt-3 a.badge-light');
  if (genreLinks.length) {
    genres = genreLinks.map((i, el) => $(el).text().trim()).get().join(', ');
  }

  // فريق العمل
  const cast = [];
  $('div.entry-box-3').each((i, el) => {
    const img = $(el).find('img');
    let imgUrl = img.attr('src') || '';
    if (imgUrl && !imgUrl.startsWith('http')) imgUrl = 'https:' + imgUrl;
    const name = $(el).find('div.entry-title').text().trim();
    if (name) cast.push({ name, image: imgUrl });
  });

  // روابط التحميل الوسيطة
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
    title,
    story,
    language,
    subtitle,
    quality,
    production,
    year,
    duration,
    addedDate,
    lastUpdate,
    genres,
    cast,
    downloads,
  };
}

// ---------- 3. تحويل رابط وسيط إلى رابط مباشر نهائي ----------
async function extractDirectLink(intermediateUrl) {
  const session = createSession();
  try {
    let resp = await session.get(intermediateUrl, { maxRedirects: 5 });
    let html = resp.data;
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

    const resp2 = await session.get(internalUrl);
    const html2 = resp2.data;
    const $2 = cheerio.load(html2);

    let directUrl = null;
    const downloadBtn = $2('a.link');
    if (downloadBtn.length) {
      const href = downloadBtn.attr('href');
      if (href && (href.includes('.mp4') || href.includes('/download/'))) directUrl = href;
    }
    if (!directUrl) {
      const mp4Link = $2('a[href*=".mp4"]');
      if (mp4Link.length) directUrl = mp4Link.attr('href');
    }
    if (!directUrl) {
      const regex = /href=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i;
      const match2 = html2.match(regex);
      if (match2) directUrl = match2[1];
    }
    if (!directUrl) throw new Error('لم يتم العثور على رابط التحميل المباشر النهائي');
    if (directUrl.startsWith('//')) directUrl = 'https:' + directUrl;
    return directUrl;
  } catch (err) {
    throw new Error(`فشل استخراج الرابط المباشر: ${err.message}`);
  }
}

// ---------- 4. دالة جلب التفاصيل مع تحويل الروابط إلى كائن منظم ----------
async function getMovieDetailsWithDirectLinks(movieUrl) {
  const details = await getMovieDetails(movieUrl);
  // تحويل مصفوفة downloads إلى كائن بمفاتيح الجودة
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
  try {
    if (search) {
      const results = await searchMovies(search, 3);
      return res.json({ success: true, data: results });
    } 
    else if (url) {
      const details = await getMovieDetailsWithDirectLinks(url);
      // إعادة ترتيب الحقول حسب الرغبة
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
    }
    else {
      return res.status(400).json({ success: false, error: 'يرجى توفير معامل search أو url' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API يعمل على المنفذ ${PORT}`);
});
