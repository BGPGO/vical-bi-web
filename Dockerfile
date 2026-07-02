# Coolify deploy — nginx static serve
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static frontend files
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY data.js /usr/share/nginx/html/
COPY app.bundle.js /usr/share/nginx/html/
COPY data-extras.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
