UPDATE app_listings
SET listing_status = 'retired',
    deployment_state = 'retired'
WHERE id = 'picfitai';
