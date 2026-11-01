self.addEventListener('install', (e) => {
    console.log('Service Worker: Installed');
});

self.addEventListener('fetch', (e) => {
    // এটি শুধু PWA রিকোয়ারমেন্ট পূরণ করার জন্য রাখা হলো
});