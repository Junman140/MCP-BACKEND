package edu.bio.matching;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.machinezoo.sourceafis.FingerprintImage;
import com.machinezoo.sourceafis.FingerprintImageOptions;
import com.machinezoo.sourceafis.FingerprintMatcher;
import com.machinezoo.sourceafis.FingerprintTemplate;
import io.javalin.Javalin;
import io.javalin.http.Context;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;

/**
 * SourceAFIS HTTP microservice: extract template, 1:1 match, heuristic quality score.
 */
public final class MatchService {
    private static final ObjectMapper M = new ObjectMapper();
    private static final double DEFAULT_THRESHOLD = 20.0;

    public static void main(String[] args) {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "5050"));
        Javalin app = Javalin.create(c -> c.showJavalinBanner = false);
        app.get("/health", ctx -> ctx.json(Map.of("status", "ok")));
        app.post("/extract", MatchService::extract);
        app.post("/match", MatchService::match);
        app.post("/quality", MatchService::quality);
        app.start(port);
    }

    private static void extract(Context ctx) throws Exception {
        JsonNode body = M.readTree(ctx.body());
        byte[] bytes = b64(body, "image_base64");
        String format = body.path("format").asText("png");
        int dpi = body.path("dpi").asInt(500);
        FingerprintImage image;
        if ("png".equals(format)) {
            image = new FingerprintImage(bytes, new FingerprintImageOptions().dpi(dpi));
        } else if ("raw_gray8".equals(format)) {
            int w = body.get("width").asInt();
            int h = body.get("height").asInt();
            if (bytes.length != w * h) {
                ctx.status(400).result("raw_gray8 size mismatch");
                return;
            }
            image = new FingerprintImage(w, h, bytes, new FingerprintImageOptions().dpi(dpi));
        } else {
            ctx.status(400).result("Unsupported format");
            return;
        }
        FingerprintTemplate tmpl = new FingerprintTemplate(image);
        byte[] out = tmpl.toByteArray();
        ctx.json(Map.of(
                "template_base64", Base64.getEncoder().encodeToString(out),
                "template_version", "sourceafis-v1"
        ));
    }

    private static void match(Context ctx) throws Exception {
        JsonNode body = M.readTree(ctx.body());
        byte[] probe = b64(body, "probe_template_base64");
        byte[] cand = b64(body, "candidate_template_base64");
        FingerprintTemplate p = new FingerprintTemplate(probe);
        FingerprintTemplate c = new FingerprintTemplate(cand);
        FingerprintMatcher matcher = new FingerprintMatcher(p);
        double score = matcher.match(c);
        double thr = body.path("threshold").asDouble(DEFAULT_THRESHOLD);
        ctx.json(Map.of(
                "score", score,
                "matched", score >= thr,
                "threshold", thr
        ));
    }

    private static void quality(Context ctx) throws Exception {
        JsonNode body = M.readTree(ctx.body());
        byte[] bytes = b64(body, "image_base64");
        String format = body.path("format").asText("png");
        BufferedImage gray;
        if ("png".equals(format)) {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img == null) {
                ctx.status(400).result("Invalid PNG");
                return;
            }
            gray = toGray(img);
        } else if ("raw_gray8".equals(format)) {
            int w = body.get("width").asInt();
            int h = body.get("height").asInt();
            if (bytes.length != w * h) {
                ctx.status(400).result("raw_gray8 size mismatch");
                return;
            }
            gray = new BufferedImage(w, h, BufferedImage.TYPE_BYTE_GRAY);
            gray.getRaster().setDataElements(0, 0, w, h, bytes);
        } else {
            ctx.status(400).result("Unsupported format");
            return;
        }
        double score = heuristicQuality(gray);
        ctx.json(Map.of(
                "score", score,
                "model_version", "heuristic-v1"
        ));
    }

    private static BufferedImage toGray(BufferedImage src) {
        BufferedImage g = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g2 = g.createGraphics();
        g2.drawImage(src, 0, 0, null);
        g2.dispose();
        return g;
    }

    /** Laplacian variance + contrast proxy -> 0-100 (MVP; swap for ONNX/CNN later). */
    private static double heuristicQuality(BufferedImage gray) {
        int w = gray.getWidth();
        int h = gray.getHeight();
        if (w < 2 || h < 2) return 0.0;
        double[] lap = new double[(w - 2) * (h - 2)];
        int i = 0;
        for (int y = 1; y < h - 1; y++) {
            for (int x = 1; x < w - 1; x++) {
                int c = gray.getRaster().getSample(x, y, 0);
                int n = gray.getRaster().getSample(x, y - 1, 0);
                int s = gray.getRaster().getSample(x, y + 1, 0);
                int e = gray.getRaster().getSample(x + 1, y, 0);
                int wv = gray.getRaster().getSample(x - 1, y, 0);
                double l = 4.0 * c - n - s - e - wv;
                lap[i++] = l;
            }
        }
        double mean = 0;
        for (double v : lap) mean += v;
        mean /= lap.length;
        double var = 0;
        for (double v : lap) {
            double d = v - mean;
            var += d * d;
        }
        var /= lap.length;
        double contrast = stdDevGray(gray);
        double s = 100.0 * (1.0 - Math.exp(-var / 800.0)) + Math.min(30.0, contrast / 8.0);
        return Math.min(100.0, Math.round(s * 100.0) / 100.0);
    }

    private static double stdDevGray(BufferedImage gray) {
        int w = gray.getWidth();
        int h = gray.getHeight();
        long sum = 0;
        int n = w * h;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                sum += gray.getRaster().getSample(x, y, 0);
            }
        }
        double m = (double) sum / n;
        double acc = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                double d = gray.getRaster().getSample(x, y, 0) - m;
                acc += d * d;
            }
        }
        return Math.sqrt(acc / n);
    }

    private static byte[] b64(JsonNode body, String field) {
        JsonNode n = body.get(field);
        if (n == null || n.isNull()) {
            throw new IllegalArgumentException("missing " + field);
        }
        return Base64.getDecoder().decode(n.asText());
    }
}
