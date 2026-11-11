use slint::{Rgba8Pixel, SharedPixelBuffer};

pub const THUMBNAIL: u32 = 96;

pub fn decode(bytes: &[u8]) -> Option<SharedPixelBuffer<Rgba8Pixel>> {
    let image = image::load_from_memory(bytes).ok()?.thumbnail(THUMBNAIL, THUMBNAIL).to_rgba8();
    let (width, height) = image.dimensions();
    Some(SharedPixelBuffer::clone_from_slice(image.as_raw(), width, height))
}

pub fn guild_icon(cdn: &str, guild_id: &str, hash: &str) -> String {
    format!("{cdn}/icons/{guild_id}/{hash}.png?size={THUMBNAIL}")
}

pub fn avatar(cdn: &str, user_id: &str, hash: &str) -> String {
    format!("{cdn}/avatars/{user_id}/{hash}.png?size={THUMBNAIL}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_decodes_to_a_thumbnail() {
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(300, 150, image::Rgba([10, 20, 30, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let buffer = decode(&png).unwrap();
        assert_eq!((buffer.width(), buffer.height()), (96, 48));
        assert!(decode(b"not an image").is_none());
    }

    #[test]
    fn urls_point_at_the_cdn() {
        assert_eq!(avatar("https://cdn.example.org", "1", "abc"), "https://cdn.example.org/avatars/1/abc.png?size=96");
        assert_eq!(guild_icon("https://cdn.example.org", "2", "def"), "https://cdn.example.org/icons/2/def.png?size=96");
    }
}
